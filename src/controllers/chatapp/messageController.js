import { Message } from "../../models/chatapp/message.js";
import { Chat } from "../../models/chatapp/chat.js";
import { User } from "../../models/user.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { emitSocketEvent } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import {
  uploadOnCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinary.js";
import admin from "../../utils/firabse.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
/**
 * @desc    Get all messages in a chat
 * @route   GET /api/v1/messages/:chatId
 * @access  Private
 */
export const getAllMessages = asyncHandler(async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50, before } = req.query;

    // Verify chat exists and user is participant
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    });

    if (!chat) {
      throw new ApiError(404, "Chat not found or access denied");
    }

    // Build query for messages
    let messageQuery = {
      chat: chatId,
      "deleted.isDeleted": false,
    };

    // For pagination - get messages before a certain date
    if (before) {
      messageQuery.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(messageQuery)
      .populate("sender", "fullName username avatar")
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "fullName username avatar ",
        },
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments(messageQuery);

    // Mark messages as delivered
    const undeliveredMessages = messages.filter(
      (message) =>
        message.sender._id.toString() !== userId.toString() &&
        !message.deliveredTo.some(
          (delivery) => delivery.user.toString() === userId.toString()
        )
    );

    for (const message of undeliveredMessages) {
      await message.markAsDelivered(userId);

      // Notify sender about delivery
      emitSocketEvent(
        req,
        message.sender._id.toString(),
        ChatEventsEnum.MESSAGE_DELIVERED_EVENT,
        {
          messageId: message._id,
          chatId,
          deliveredTo: userId,
          deliveredAt: new Date(),
        }
      );
    }

    const response = {
      messages: messages, // Removed reverse() - now newest first
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalMessages: total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };

    return res
      .status(200)
      .json(new ApiResponse(200, response, "Messages retrieved successfully"));
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});

/**
 * @desc    Send a message
 * @route   POST /api/v1/messages/:chatId
 * @access  Private
 */
export const sendMessage = asyncHandler(async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const { content, type = "text", replyTo, isForwarded = false } = req.body;

    // Validate input
    if (!content && (!req.files || req.files.length === 0)) {
      throw new ApiError(400, "Message content or media is required");
    }

    // Find chat and populate participants
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    }).populate("participants", "_id fullName avatar deviceToken role");

    if (!chat) {
      throw new ApiError(404, "Chat not found or access denied");
    }

    // Validate active session
    const activeSession = await ChatSession.findOne({
      chatId,
      $or: [
        { status: "ACTIVE" },
        { status: "ACCEPTED", astrologerId: userId },
      ],
    });

    if (!activeSession) {
      throw new ApiError(400, "No active session found for this chat");
    }

    // Role-based permission check
    if (req.user.role === "user") {
      if (activeSession.status !== "ACTIVE") {
        throw new ApiError(400, "Session is not active. Please wait for astrologer to start.");
      }
      if (activeSession.userId.toString() !== userId.toString()) {
        throw new ApiError(403, "You are not authorized to send messages in this session");
      }
    } else if (req.user.role === "astrologer") {
      if (!["ACCEPTED", "ACTIVE"].includes(activeSession.status)) {
        throw new ApiError(400, "Session is not active or accepted");
      }
      if (activeSession.astrologerId.toString() !== userId.toString()) {
        throw new ApiError(403, "You are not the astrologer for this session");
      }
    }

    // Validate reply message
    if (replyTo) {
      const repliedMsg = await Message.findOne({
        _id: replyTo,
        chat: chatId,
        "deleted.isDeleted": false,
      });
      if (!repliedMsg) throw new ApiError(404, "Message you're replying to not found");
    }

    // Prepare message content
    let messageData = {
      chat: chatId,
      sender: userId,
      type,
      isForwarded,
    };

    let textContent = "";

    if (content) {
      if (typeof content === "object" && content.text) {
        textContent = content.text.trim();
      } else if (typeof content === "string") {
        textContent = content.trim();
      }
    }

    if (textContent) {
      messageData.content = { text: textContent };
    }

    // Handle media upload
    if (req.files && req.files.length > 0) {
      const mediaFiles = [];
      for (const file of req.files) {
        const uploadResult = await uploadOnCloudinary(file.path, "chat_media");
        mediaFiles.push({
          type: getMediaType(file.mimetype),
          url: uploadResult.url,
          publicId: uploadResult.public_id,
          filename: file.originalname,
          size: file.size,
        });
      }
      messageData.content = { media: mediaFiles };
      messageData.type = mediaFiles[0].type;
    }

    if (replyTo) messageData.replyTo = replyTo;

    // Create the message
    const message = await Message.create(messageData);

    // Populate sender and replyTo
    await message.populate([
      { path: "sender", select: "fullName username avatar role" },
      {
        path: "replyTo",
        populate: { path: "sender", select: "fullName username avatar" },
      },
    ]);

    // Update chat & session
    chat.lastMessage = message._id;
    activeSession.lastActivityAt = new Date();
    await Promise.all([chat.save(), activeSession.save()]);

    // Final message object for client & socket
    const messageForClient = {
      _id: message._id,
      content: message.content,
      type: message.type,
      sender: {
        _id: message.sender._id,
        fullName: message.sender.fullName,
        username: message.sender.username,
        avatar: message.sender.avatar,
        role: message.sender.role,
      },
      chatId: chatId,
      replyTo: message.replyTo,
      isForwarded: message.isForwarded,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      readBy: [userId],
    };

    // BULLETPROOF REAL-TIME DELIVERY
    const io = req.app.get("io");

    // 1. Emit to chat room (normal case)
    io.to(chatId).emit(ChatEventsEnum.NEW_MESSAGE_EVENT, messageForClient);

    // 2. CRITICAL FALLBACK: Emit directly to each participant's personal room
    chat.participants.forEach((participant) => {
      const pid = participant._id.toString();
      if (pid !== userId.toString()) {
        io.to(pid).emit(ChatEventsEnum.NEW_MESSAGE_EVENT, messageForClient);
      }
    });

    console.log(`Message delivered via room + personal rooms`);

    // Send push notifications to receivers
    const receivers = chat.participants.filter(
      (p) => p._id.toString() !== userId.toString()
    );

    receivers.forEach(async (receiver) => {
      try {
        await sendNotification({
          userId: receiver._id,
          title: message.sender.fullName || "New Message",
          message:
            type === "text"
              ? (textContent || "New message")
              : type === "image"
                ? "Sent a photo"
                : type === "video"
                  ? "Sent a video"
                  : type === "audio"
                    ? "Sent a voice message"
                    : "Sent a file",
          chatId,
          messageId: message._id,
          senderId: userId,
          senderName: message.sender.fullName,
          senderAvatar: message.sender.avatar,
          type: "chat_message",
        });
      } catch (err) {
        console.error("Push notification failed:", err.message);
      }
    });

    // Success response
    return res
      .status(201)
      .json(new ApiResponse(201, messageForClient, "Message sent successfully"));

  } catch (error) {
    console.error("sendMessage error:", error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to send message");
  }
});

/**
 * @desc    Mark all messages in a chat as read for current user
 * @route   POST /api/v1/chat/:chatId/mark-all-read
 * @access  Private
 */
export const markAllMessagesAsRead = asyncHandler(async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    
    console.log(`Marking all messages as read for user ${userId} in chat ${chatId}`);

    // Verify chat exists and user is participant
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    });

    if (!chat) {
      throw new ApiError(404, "Chat not found or access denied");
    }

    // 1. Update ALL messages sent by others that haven't been read by this user
    const updateResult = await Message.updateMany(
      {
        chat: chatId,
        sender: { $ne: userId }, // Messages not sent by current user
        "readBy.user": { $ne: userId } // Not already read by this user
      },
      {
        $addToSet: {
          readBy: {
            user: userId,
            readAt: new Date()
          }
        },
        $set: {
          status: "read" // Update status to read
        }
      }
    );

    console.log(`Marked ${updateResult.modifiedCount} messages as read`);

    // 2. Update chat's lastRead timestamp for this user
    await Chat.findByIdAndUpdate(chatId, {
      $set: {
        [`lastRead.${userId}`]: new Date()
      }
    });

    // 3. Emit socket event to notify the sender(s) that their messages were read
    if (updateResult.modifiedCount > 0) {
      const io = req.app.get("io");
      
      // Get distinct senders of messages that were just marked as read
      const messages = await Message.find({
        chat: chatId,
        sender: { $ne: userId },
        "readBy.user": userId
      }).distinct('sender');
      
      // Notify each sender that their messages were read
      messages.forEach(senderId => {
        if (senderId.toString() !== userId.toString()) {
          // Emit to sender's personal room
          io.to(senderId.toString()).emit(
            ChatEventsEnum.MESSAGE_READ_EVENT,
            {
              chatId,
              userId, // Who read the messages
              timestamp: new Date(),
              allRead: true // Flag indicating all messages were read
            }
          );
          
          // Also emit to chat room
          io.to(chatId).emit(
            ChatEventsEnum.BULK_MESSAGES_READ_EVENT,
            {
              chatId,
              readerId: userId,
              readAt: new Date(),
              messageCount: updateResult.modifiedCount
            }
          );
        }
      });
    }

    // 4. Get the updated chat with participants
    const updatedChat = await Chat.findById(chatId)
      .populate("participants", "_id fullName avatar");

    // 5. Get the most recent messages to return updated read status
    const recentMessages = await Message.find({ chat: chatId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("sender", "fullName username avatar role")
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "fullName username avatar"
        }
      });

    const response = {
      success: true,
      message: `Marked ${updateResult.modifiedCount} messages as read`,
      data: {
        modifiedCount: updateResult.modifiedCount,
        chat: {
          _id: updatedChat._id,
          participants: updatedChat.participants.map(p => ({
            _id: p._id,
            fullName: p.fullName,
            avatar: p.avatar
          })),
          lastRead: updatedChat.lastRead || {}
        },
        recentMessages: recentMessages.map(msg => ({
          _id: msg._id,
          content: msg.content,
          type: msg.type,
          sender: {
            _id: msg.sender._id,
            fullName: msg.sender.fullName,
            avatar: msg.sender.avatar,
            role: msg.sender.role
          },
          readBy: msg.readBy,
          status: msg.status,
          createdAt: msg.createdAt
        }))
      }
    };

    return res
      .status(200)
      .json(new ApiResponse(200, response, "All messages marked as read successfully"));

  } catch (error) {
    console.error("markAllMessagesAsRead error:", error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to mark messages as read");
  }
});


/**
 * @desc    Delete a message
 * @route   DELETE /api/v1/messages/:messageId
 * @access  Private
 */
export const deleteMessage = asyncHandler(async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    const { deleteType = "forMe" } = req.body; // "forMe" or "forEveryone"

    // Find the message
    const message = await Message.findById(messageId).populate("chat");

    if (!message) {
      throw new ApiError(404, "Message not found");
    }

    // Verify user has permission to delete
    const isSender = message.sender.toString() === userId.toString();
    const isChatParticipant = message.chat.participants.includes(userId);

    if (!isChatParticipant) {
      throw new ApiError(403, "Not authorized to delete this message");
    }

    if (deleteType === "forEveryone" && !isSender) {
      throw new ApiError(403, "Only sender can delete message for everyone");
    }

    // Delete media from cloud storage if deleting for everyone
    if (deleteType === "forEveryone" && message.content.media) {
      for (const media of message.content.media) {
        if (media.publicId) {
          await deleteFromCloudinary(media.publicId);
        }
      }
    }

    // Update message deletion status
    message.deleted = {
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: userId,
      deleteType,
    };

    // For "forEveryone", replace content with deletion notice
    if (deleteType === "forEveryone") {
      message.content.text = "This message was deleted";
      message.content.media = [];
      message.type = "text";
    }

    await message.save();

    // Emit socket event
    emitSocketEvent(
      req,
      message.chat._id.toString(),
      ChatEventsEnum.MESSAGE_DELETED_EVENT,
      {
        messageId: message._id,
        chatId: message.chat._id,
        deletedBy: userId,
        deleteType,
      }
    );

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Message deleted successfully"));
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});

/**
 * @desc    React to a message
 * @route   PUT /api/v1/messages/:messageId/react
 * @access  Private
 */
export const reactToMessage = asyncHandler(async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    const { emoji } = req.body;

    if (!emoji) {
      throw new ApiError(400, "Emoji is required");
    }

    const message = await Message.findById(messageId).populate("chat");

    if (!message) {
      throw new ApiError(404, "Message not found");
    }

    // Verify user is chat participant
    if (!message.chat.participants.includes(userId)) {
      throw new ApiError(403, "Not authorized to react to this message");
    }

    // Remove existing reaction from same user
    message.reactions = message.reactions.filter(
      (reaction) => reaction.user.toString() !== userId.toString()
    );

    // Add new reaction
    message.reactions.push({
      user: userId,
      emoji,
      reactedAt: new Date(),
    });

    await message.save();

    // Populate reaction user info
    await message.populate("reactions.user", "fullName username avatar");

    // Emit socket event
    emitSocketEvent(
      req,
      message.chat._id.toString(),
      ChatEventsEnum.MESSAGE_REACTION_EVENT,
      {
        messageId: message._id,
        reaction: message.reactions.find(
          (r) => r.user._id.toString() === userId.toString()
        ),
        chatId: message.chat._id,
      }
    );

    return res
      .status(200)
      .json(
        new ApiResponse(200, message.reactions, "Reaction added successfully")
      );
  } catch (error) {
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Internal Server Error"));
  }
});

// Helper function to determine media type
const getMediaType = (mimetype) => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "file";
};

export async function sendNotification({
  userId,
  title,
  message,
  chatId,
  messageId,
  senderId,
  senderName,
  senderAvatar,
  type = "chat_message",
  channelId = "chat_channel",
}) {
  try {
    // 1️⃣ Fetch user's device token
    const user = await User.findById(userId).select("deviceToken fullName");
    if (!user) {
      console.warn(`⚠️ No user found with ID: ${userId}`);
      return;
    }

    if (!user.deviceToken) {
      console.warn(`⚠️ No device token for user: ${userId}`);
      return;
    }

    const deviceToken = user.deviceToken;

    // 2️⃣ Prepare payload
    const payload = {
      token: deviceToken,
      notification: {
        title,
        body: message,
      },
      data: {
        type, // 'chat_message', 'incoming_call', etc.
        channelId,
        screen: "AstrologerChat",
        chatId: chatId?.toString() || "",
        messageId: messageId?.toString() || "",
        senderId: senderId?.toString() || "",
        senderName: senderName || "",
        senderAvatar: senderAvatar || "",
      },
      android: {
        priority: "high",
        notification: {
          channelId, // 👈 must match a created Notifee channel
          sound: "default",
          clickAction: "FLUTTER_NOTIFICATION_CLICK", // helps Android navigation
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            alert: {
              title,
              body: message,
            },
            sound: "default",
            contentAvailable: true,
          },
        },
      },
    };

    // 3️⃣ Send FCM notification
    const response = await admin.messaging().send(payload);
    console.log(
      `✅ Notification sent to ${user.fullName || userId} (${channelId}):`,
      response
    );
  } catch (error) {
    console.error("❌ Error sending notification:", error);
  }
}
