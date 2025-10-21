import { Chat } from "../models/chat.js";
import { Message } from "../models/message.js";
import { User } from "../models/user.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { emitSocketEvent } from "../socket/socketServer.js";
import { ChatEventsEnum } from "../constants.js";


import { Chat } from "../../models/chatapp/chat.js";
import { Message } from "../../models/chatapp/message.js";
import { User } from "../../models/user.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
/**
 * 
 * @desc    Create or get a one-on-one chat
 * @route   POST /api/v1/chats/one-on-one
 * @access  Private
 */
export const createOrGetAOneOnOneChat = asyncHandler(async (req, res) => {
    const { participantId } = req.body;
    const currentUserId = req.user._id;

    // Validate participant
    if (!participantId) {
        throw new ApiError(400, "Participant ID is required");
    }

    if (participantId.toString() === currentUserId.toString()) {
        throw new ApiError(400, "Cannot create chat with yourself");
    }

    // Check if participant exists and is not blocked
    const participant = await User.findById(participantId);
    if (!participant) {
        throw new ApiError(404, "Participant not found");
    }

    if (req.user.blockedUsers.includes(participantId)) {
        throw new ApiError(403, "You have blocked this user");
    }

    if (participant.blockedUsers.includes(currentUserId)) {
        throw new ApiError(403, "This user has blocked you");
    }

    // Find or create personal chat
    const chat = await Chat.findOrCreatePersonalChat(currentUserId, participantId);

    // Populate necessary fields
    await chat.populate([
        { path: "participants", select: "fullName username email avatar status isOnline lastSeen" },
        {
            path: "lastMessage",
            populate: {
                path: "sender",
                select: "fullName username avatar"
            }
        }
    ]);

    // Emit socket event for real-time updates
    emitSocketEvent(req, participantId.toString(), ChatEventsEnum.NEW_CHAT_EVENT, chat);

    return res.status(200).json(
        new ApiResponse(200, chat, "Chat retrieved/created successfully")
    );
});

/**
 * @desc    Delete one-on-one chat
 * @route   DELETE /api/v1/chats/:chatId
 * @access  Private
 */
export const deleteOneOnOneChat = asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user._id;

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
            "deleted.isDeleted": false
        },
        {
            $set: {
                "deleted.isDeleted": true,
                "deleted.deletedAt": new Date(),
                "deleted.deletedBy": userId,
                "deleted.deleteType": "forMe"
            }
        }
    );

    // Remove user from chat participants (or mark as inactive)
    // In a real implementation, you might want to maintain chat history
    // while hiding it from the user who deleted it

    // Emit socket event
    emitSocketEvent(req, chatId, ChatEventsEnum.CHAT_DELETED_EVENT, {
        chatId,
        deletedBy: userId
    });

    return res.status(200).json(
        new ApiResponse(200, null, "Chat deleted successfully")
    );
});

/**
 * @desc    Search available users for chat
 * @route   GET /api/v1/chats/search-users
 * @access  Private
 */
export const searchAvailableUsers = asyncHandler(async (req, res) => {
    const { query, page = 1, limit = 20 } = req.query;
    const userId = req.user._id;

    if (!query || query.trim().length < 2) {
        throw new ApiError(400, "Search query must be at least 2 characters long");
    }

    const searchRegex = new RegExp(query, "i");

    // Build search criteria
    const searchCriteria = {
        _id: { $ne: userId }, // Exclude current user
        $and: [
            { blockedUsers: { $ne: userId } }, // Users who haven't blocked current user
            { _id: { $nin: req.user.blockedUsers } } // Users not blocked by current user
        ],
        $or: [
            { fullName: { $regex: searchRegex } },
            { username: { $regex: searchRegex } },
            { email: { $regex: searchRegex } },
            { phone: { $regex: searchRegex } }
        ]
    };

    const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { fullName: 1 },
        select: "fullName username email avatar status isOnline lastSeen"
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
            hasPrev: page > 1
        }
    };

    return res.status(200).json(
        new ApiResponse(200, response, "Users retrieved successfully")
    );
});

/**
 * @desc    Get all chats for a user
 * @route   GET /api/v1/chats
 * @access  Private
 */
export const getAllChats = asyncHandler(async (req, res) => {
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
                select: "fullName username avatar status isOnline lastSeen"
            },
            {
                path: "lastMessage",
                populate: {
                    path: "sender",
                    select: "fullName username avatar"
                }
            }
        ]
    };

    const chats = await Chat.find(chatQuery)
        .populate([
            {
                path: "participants",
                select: "fullName username avatar status isOnline lastSeen"
            },
            {
                path: "lastMessage",
                populate: {
                    path: "sender",
                    select: "fullName username avatar"
                }
            }
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
                "deleted.isDeleted": false
            });

            const chatObj = chat.toObject();
            chatObj.unreadCount = unreadCount;

            // Get other participant for personal chats
            if (!chat.isGroupChat) {
                const otherParticipant = chat.participants.find(
                    participant => participant._id.toString() !== userId.toString()
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
            hasPrev: page > 1
        }
    };

    return res.status(200).json(
        new ApiResponse(200, response, "Chats retrieved successfully")
    );
});

/**
 * @desc    Mark messages as read in a chat
 * @route   PUT /api/v1/chats/:chatId/mark-read
 * @access  Private
 */
export const markMessageAsRead = asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user._id;

    // Verify chat exists and user is participant
    const chat = await Chat.findOne({
        _id: chatId,
        participants: userId
    });

    if (!chat) {
        throw new ApiError(404, "Chat not found or access denied");
    }

    // Find unread messages in this chat
    const unreadMessages = await Message.find({
        chat: chatId,
        sender: { $ne: userId },
        "readBy.user": { $ne: userId },
        "deleted.isDeleted": false
    });

    // Mark each message as read
    for (const message of unreadMessages) {
        await message.markAsRead(userId);

        // Emit socket event for real-time read receipt
        emitSocketEvent(req, chatId, ChatEventsEnum.MESSAGE_READ_EVENT, {
            messageId: message._id,
            chatId,
            readBy: userId,
            readAt: new Date()
        });

        // Notify sender that message was read
        if (message.sender.toString() !== userId.toString()) {
            emitSocketEvent(req, message.sender.toString(), ChatEventsEnum.MESSAGE_READ_EVENT, {
                messageId: message._id,
                chatId,
                readBy: userId,
                readAt: new Date()
            });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, { markedCount: unreadMessages.length }, "Messages marked as read")
    );
});