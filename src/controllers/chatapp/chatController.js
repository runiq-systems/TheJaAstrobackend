import { Chat } from "../../models/chatapp/chat.js";
import { Message } from "../../models/chatapp/message.js";
import { User } from "../../models/user.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { emitSocketEvent } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import logger from "../../utils/logger.js";
import mongoose from "mongoose";
import { Astrologer } from "../../models/astrologer.js";
/**
 *
 * @desc    Create or get a one-on-one chat
 * @route   POST /api/v1/chats/one-on-one
 * @access  Private
 */
export const createOrGetAOneOnOneChat = asyncHandler(async (req, res) => {
  try {
    const { participantId } = req.body;
    const currentUserId = req.user.id;

    // Validate participant
    if (!participantId) {
      throw new ApiError(400, "Participant ID is required");
    }

    if (participantId.toString() === currentUserId.toString()) {
      throw new ApiError(400, "Cannot create chat with yourself");
    }

    // Fetch participant
    const participant = await User.findById(participantId);
    if (!participant) {
      throw new ApiError(404, "Participant not found");
    }

    // Safe blockedUsers check
    const currentUserBlocked = Array.isArray(req.user.blockedUsers)
      ? req.user.blockedUsers
      : [];
    const participantBlocked = Array.isArray(participant.blockedUsers)
      ? participant.blockedUsers
      : [];

    if (currentUserBlocked.includes(participantId)) {
      throw new ApiError(403, "You have blocked this user");
    }

    if (participantBlocked.includes(currentUserId)) {
      throw new ApiError(403, "This user has blocked you");
    }

    // Find or create 1-on-1 chat
    const chat = await Chat.findOrCreatePersonalChat(
      currentUserId,
      participantId
    );

    if (!chat) {
      throw new ApiError(500, "Unable to create or retrieve chat");
    }

    // Populate necessary fields
    await chat.populate([
      {
        path: "participants",
        select: "fullName username email avatar status isOnline lastSeen",
      },
      {
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "fullName username avatar",
        },
      },
    ]);

    // Emit socket event (optional, safe)
    if (typeof emitSocketEvent === "function") {
      emitSocketEvent(
        req,
        participantId.toString(),
        ChatEventsEnum.NEW_CHAT_EVENT,
        chat
      );
    }

    return res
      .status(200)
      .json(new ApiResponse(200, chat, "Chat retrieved/created successfully"));
  } catch (error) {
    console.error("Create/Get Chat Error:", error);
    return res
      .status(500)
      .json(
        new ApiResponse(500, null, error.message || "Internal Server Error")
      );
  }
});

/**
 * @desc    Delete one-on-one chat
 * @route   DELETE /api/v1/chats/:chatId
 * @access  Private
 */
export const deleteOneOnOneChat = asyncHandler(async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    // Find the chat
    const chat = await Chat.findById(chatId);
    if (!chat) {
      throw new ApiError(404, "Chat not found");
    }

    // Verify user is a participant
    if (!chat.participants.includes(userId)) {
      throw new ApiError(403, "Not authorized to delete this chat");
    }

    // For one-on-one chats, we'll archive/soft delete instead of hard delete
    // Mark messages as deleted for this user
    await Message.updateMany(
      {
        chat: chatId,
        "deleted.isDeleted": false,
      },
      {
        $set: {
          "deleted.isDeleted": true,
          "deleted.deletedAt": new Date(),
          "deleted.deletedBy": userId,
          "deleted.deleteType": "forMe",
        },
      }
    );

    // Remove user from chat participants (or mark as inactive)
    // In a real implementation, you might want to maintain chat history
    // while hiding it from the user who deleted it

    // Emit socket event
    emitSocketEvent(req, chatId, ChatEventsEnum.CHAT_DELETED_EVENT, {
      chatId,
      deletedBy: userId,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Chat deleted successfully"));
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});

/**
 * @desc    Search available users for chat
 * @route   GET /api/v1/chats/search-users
 * @access  Private
 */
export const searchAvailableUsers = asyncHandler(async (req, res) => {
  try {
    const { query, page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 2) {
      throw new ApiError(
        400,
        "Search query must be at least 2 characters long"
      );
    }

    const searchRegex = new RegExp(query, "i");

    // Build search criteria
    const searchCriteria = {
      _id: { $ne: userId }, // Exclude current user
      $and: [
        { blockedUsers: { $ne: userId } }, // Users who haven't blocked current user
        { _id: { $nin: req.user.blockedUsers } }, // Users not blocked by current user
      ],
      $or: [
        { fullName: { $regex: searchRegex } },
        { username: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
        { phone: { $regex: searchRegex } },
      ],
    };

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { fullName: 1 },
      select: "fullName username email avatar status isOnline lastSeen",
    };

    // Using pagination for better performance
    const users = await User.find(searchCriteria)
      .select("fullName username email avatar status isOnline lastSeen")
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ fullName: 1 });

    const total = await User.countDocuments(searchCriteria);

    const response = {
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };

    return res
      .status(200)
      .json(new ApiResponse(200, response, "Users retrieved successfully"));
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});

/**
 * @desc    Get all chats for a user
 * @route   GET /api/v1/chats
 * @access  Private
 */
export const getAllChats = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, type = "all" } = req.query;

    // Build query based on type
    let chatQuery = { participants: userId };

    if (type === "personal") {
      chatQuery.isGroupChat = false;
    } else if (type === "group") {
      chatQuery.isGroupChat = true;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { updatedAt: -1 }, // Most recently updated first
      populate: [
        {
          path: "participants",
          select: "fullName username avatar status isOnline lastSeen",
        },
        {
          path: "lastMessage",
          populate: {
            path: "sender",
            select: "fullName username avatar",
          },
        },
      ],
    };

    const chats = await Chat.find(chatQuery)
      .populate([
        {
          path: "participants",
          select: "fullName username avatar status isOnline lastSeen",
        },
        {
          path: "lastMessage",
          populate: {
            path: "sender",
            select: "fullName username avatar",
          },
        },
      ])
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Chat.countDocuments(chatQuery);

    // Enhance chat data with unread count and last message preview
    const enhancedChats = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chat: chat._id,
          sender: { $ne: userId },
          "readBy.user": { $ne: userId },
          "deleted.isDeleted": false,
        });

        const chatObj = chat.toObject();
        chatObj.unreadCount = unreadCount;

        // Get other participant for personal chats
        if (!chat.isGroupChat) {
          const otherParticipant = chat.participants.find(
            (participant) => participant._id.toString() !== userId.toString()
          );
          chatObj.otherParticipant = otherParticipant;
        }

        return chatObj;
      })
    );

    const response = {
      chats: enhancedChats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalChats: total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };

    return res
      .status(200)
      .json(new ApiResponse(200, response, "Chats retrieved successfully"));
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});

/**
 * @desc    Mark messages as read in a chat
 * @route   PUT /api/v1/chats/:chatId/mark-read
 * @access  Private
 */
export const markMessageAsRead = asyncHandler(async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    // Verify chat exists and user is participant
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    });

    if (!chat) {
      throw new ApiError(404, "Chat not found or access denied");
    }

    // Find unread messages in this chat
    const unreadMessages = await Message.find({
      chat: chatId,
      sender: { $ne: userId },
      "readBy.user": { $ne: userId },
      "deleted.isDeleted": false,
    });

    // Mark each message as read
    for (const message of unreadMessages) {
      await message.markAsRead(userId);

      // Emit socket event for real-time read receipt
      emitSocketEvent(req, chatId, ChatEventsEnum.MESSAGE_READ_EVENT, {
        messageId: message._id,
        chatId,
        readBy: userId,
        readAt: new Date(),
      });

      // Notify sender that message was read
      if (message.sender.toString() !== userId.toString()) {
        emitSocketEvent(
          req,
          message.sender.toString(),
          ChatEventsEnum.MESSAGE_READ_EVENT,
          {
            messageId: message._id,
            chatId,
            readBy: userId,
            readAt: new Date(),
          }
        );
      }
    }

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { markedCount: unreadMessages.length },
          "Messages marked as read"
        )
      );
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});
/**
 * @desc    Get all users (excluding current user)
 * @route   GET /api/v1/chats/all-users
 * @access  Private
 */


export const getAllAstrologers = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    const { page = 1, limit = 20, search = "" } = req.query;
    const searchRegex = new RegExp(search, "i");

    // 🔍 Search criteria
    const criteria = {
      _id: { $ne: userId }, // exclude current user
      role: "astrologer",   // ONLY astrologers
      ...(search
        ? {
          $or: [
            { fullName: { $regex: searchRegex } },
            { email: { $regex: searchRegex } },
            { phone: { $regex: searchRegex } },
          ],
        }
        : {}),
    };

    const currentPage = parseInt(page) || 1;
    const perPage = parseInt(limit) || 20;

    // 📌 Fetch users + astrologer profile
    const users = await User.find(criteria)
      .select(
        "fullName _id phone role status isOnline lastSeen isverified"
      )
      .limit(perPage)
      .skip((currentPage - 1) * perPage)
      .sort({ fullName: 1 });

    // 📌 Pull astrologer details
    const astrologerIds = users.map((u) => u._id);

    const astrologerData = await Astrologer.find({
      userId: { $in: astrologerIds },
    });

    // 📌 Merge astrologer + user data
    const mergedData = users.map((user) => {
      const astro = astrologerData.find(
        (a) => String(a.userId) === String(user._id)
      );
      return {
        ...user.toObject(),
        astrologerProfile: astro || null,
      };
    });

    // 📌 count
    const totalUsers = await User.countDocuments(criteria);

    return res.status(200).json(
      new ApiResponse(200, {
        data: mergedData,
        pagination: {
          currentPage,
          totalPages: Math.ceil(totalUsers / perPage),
          totalUsers,
          hasNext: currentPage * perPage < totalUsers,
          hasPrev: currentPage > 1,
        },
      },
        "Astrologers retrieved successfully")
    );
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});




// helper to parse query ints
const toInt = v => parseInt(v, 10) || 1;

export const getRecentChats = async (req, res) => {
  try {
    const userId = mongoose.Types.ObjectId(req.user._id);
    const search = (req.query.search || "").trim();
    const page = Math.max(1, toInt(req.query.page));
    const limit = Math.min(100, toInt(req.query.limit)); // max limit safety
    const skip = (page - 1) * limit;

    const agg = [
      // 1. only chats where user participates
      { $match: { participants: userId } },

      // 2. get most recent message per chat
      {
        $lookup: {
          from: "messages",
          let: { chatId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$chat", "$$chatId"] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            // populate sender minimal
            {
              $lookup: {
                from: "users",
                localField: "sender",
                foreignField: "_id",
                as: "senderData"
              }
            },
            { $unwind: { path: "$senderData", preserveNullAndEmptyArrays: true } }
          ],
          as: "recentMessage"
        }
      },
      { $unwind: { path: "$recentMessage", preserveNullAndEmptyArrays: true } },

      // 3. compute unread count (messages not sent by me and not readBy me)
      {
        $lookup: {
          from: "messages",
          let: { chatId: "$_id", userId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$chat", "$$chatId"] },
                    { $ne: ["$sender", "$$userId"] },
                    // userId not in readBy.user
                    {
                      $not: {
                        $in: [
                          "$$userId",
                          {
                            $map: { input: "$readBy", as: "r", in: "$$r.user" }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            { $count: "unread" }
          ],
          as: "unreadAgg"
        }
      },
      {
        $addFields: {
          unreadCount: {
            $cond: [
              { $gt: [{ $size: "$unreadAgg" }, 0] },
              { $arrayElemAt: ["$unreadAgg.unread", 0] },
              0
            ]
          }
        }
      },

      // 4. populate participants (minimal fields for search and display)
      {
        $lookup: {
          from: "users",
          localField: "participants",
          foreignField: "_id",
          as: "participantsData"
        }
      },

      // 5. compute isPinned for requesting user
      {
        $addFields: {
          isPinned: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$pinnedBy",
                    as: "p",
                    cond: { $eq: ["$$p.user", userId] }
                  }
                }
              },
              0
            ]
          },

          lastActiveAt: {
            $ifNull: ["$recentMessage.createdAt", "$updatedAt"]
          }
        }
      },

      // 6. optional SEARCH filter (after participants populated)
      ...(search
        ? [
          {
            $match: {
              $expr: {
                $or: [
                  // group chat name match
                  { $regexMatch: { input: { $ifNull: ["$name", ""] }, regex: search, options: "i" } },
                  // any participant username / email matches (exclude myself)
                  {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: "$participantsData",
                            as: "u",
                            cond: {
                              $and: [
                                { $ne: ["$$u._id", userId] }, // exclude self
                                {
                                  $or: [
                                    { $regexMatch: { input: "$$u.username", regex: search, options: "i" } },
                                    { $regexMatch: { input: { $ifNull: ["$$u.email", ""] }, regex: search, options: "i" } }
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  }
                ]
              }
            }
          }
        ]
        : []),

      // 7. sort: pinned first, then by lastActiveAt desc
      { $sort: { isPinned: -1, lastActiveAt: -1 } },

      // 8. pagination
      { $skip: skip },
      { $limit: limit },

      // 9. final projection: keep only needed fields
      {
        $project: {
          name: 1,
          isGroupChat: 1,
          avatar: 1,
          description: 1,
          participants: {
            $map: {
              input: "$participantsData",
              as: "u",
              in: { _id: "$$u._id", username: "$$u.username", avatar: "$$u.avatar" }
            }
          },
          recentMessage: {
            _id: "$recentMessage._id",
            content: "$recentMessage.content",
            type: "$recentMessage.type",
            sender: "$recentMessage.senderData",
            createdAt: "$recentMessage.createdAt"
          },
          unreadCount: 1,
          isPinned: 1,
          lastActiveAt: 1
        }
      }
    ];

    const chats = await Chat.aggregate(agg);

    // total count for pagination (cheap approximate: count matches before skip/limit)
    // optional: run a smaller pipeline to get totalCount if needed
    return res.json({ success: true, chats, page, limit });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};



// services/chatService.js or controllers/chatController.js

const getRecentChats = async (currentUserId) => {
  const chats = await Chat.aggregate([
    // 1. Match only chats where the user is a participant
    {
      $match: {
        participants: new mongoose.Types.ObjectId(currentUserId)
      }
    },

    // 2. Lookup the last message (most recent one)
    {
      $lookup: {
        from: "messages",
        let: { chatId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$chat", "$$chatId"] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              content: 1,
              type: 1,
              sender: 1,
              createdAt: 1,
              readBy: 1,
              deleted: 1
            }
          }
        ],
        as: "lastMessage"
      }
    },
    { $unwind: { path: "$lastMessage", preserveNullAndEmptyArrays: true } },

    // 3. Count unread messages (messages not read by current user)
    {
      $lookup: {
        from: "messages",
        let: { chatId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$chat", "$$chatId"] },
              "readBy.user": { $ne: new mongoose.Types.ObjectId(currentUserId) },
              sender: { $ne: new mongoose.Types.ObjectId(currentUserId) },
              "deleted.isDeleted": { $ne: true }
            }
          },
          { $count: "total" }
        ],
        as: "unreadInfo"
      }
    },
    {
      $addFields: {
        unreadCount: {
          $ifNull: [{ $arrayElemAt: ["$unreadInfo.total", 0] }, 0]
        }
      }
    },

    // 4. Sort by last message time (most recent first), fallback to chat updatedAt
    {
      $sort: {
        "lastMessage.createdAt": -1,
        updatedAt: -1
      }
    },

    // 5. Final projection (clean output)
    {
      $project: {
        _id: 1,
        name: 1,
        isGroupChat: 1,
        participants: 1,
        admins: 1,
        avatar: 1,
        description: 1,
        isPrivate: 1,
        settings: 1,
        createdAt: 1,
        updatedAt: 1,

        lastMessage: {
          _id: "$lastMessage._id",
          sender: "$lastMessage.sender",
          content: "$lastMessage.content",
          type: "$lastMessage.type",
          createdAt: "$lastMessage.createdAt",
          isDeleted: "$lastMessage.deleted.isDeleted",
          preview: {
            $cond: {
              if: {
                $or: [
                  { $eq: ["$lastMessage.deleted.isDeleted", true] },
                  { $eq: ["$lastMessage.type", "system"] }
                ]
              },
              then: "Message deleted",
              else: {
                $cond: {
                  if: { $gt: [{ $strLenCP: "$lastMessage.content.text" }, 0] },
                  then: { $substrCP: ["$lastMessage.content.text", 0, 50] },
                  else: {
                    $cond: {
                      if: { $gt: [{ $size: "$lastMessage.content.media" }, 0] },
                      then: {
                        $concat: [
                          "",
                          { $toUpper: { $arrayElemAt: ["$lastMessage.content.media.type", 0] } },
                          " ",
                          { $arrayElemAt: ["$lastMessage.content.media.type", 0] }
                        ]
                      },
                      else: "System message"
                    }
                  }
                }
              }
            }
          }
        },
        unreadCount: 1,
        lastMessageAt: {
          $ifNull: ["$lastMessage.createdAt", "$updatedAt"]
        }
      }
    },

    // 6. Populate participants (only needed fields for chat list)
    {
      $lookup: {
        from: "users",
        localField: "participants",
        foreignField: "_id",
        as: "participantsInfo",
        pipeline: [
          { $project: { username: 1, fullName: 1, avatar: 1, isOnline: 1, lastActiveAt: 1 } }
        ]
      }
    },

    // For personal chats → add "otherUser" field (the person you're chatting with)
    {
      $addFields: {
        otherUser: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$participantsInfo",
                cond: { $ne: ["$$this._id", new mongoose.Types.ObjectId(currentUserId)] }
              }
            },
            0
          ]
        }
      }
    }
  ]);

  return chats;
};



// mark all unread messages in a chat as read by current user
export const markChatAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const chatId = req.params.id;

    // add readBy entry to messages where not yet present
    await Message.updateMany(
      {
        chat: chatId,
        "readBy.user": { $ne: userId }
      },
      { $push: { readBy: { user: userId, readAt: new Date() } }, $set: { status: "read" } }
    );

    // optionally update Chat.lastSeen for that user
    await Chat.findByIdAndUpdate(chatId, {
      $pull: { lastSeen: { user: userId } }
    });
    await Chat.findByIdAndUpdate(chatId, {
      $push: { lastSeen: { user: userId, seenAt: new Date() } }
    });

    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
