import { Message } from "../../models/chatapp/message.js";
import { Chat } from "../../models/chatapp/chat.js";
import { User } from "../../models/user.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { emitSocketEvent } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../../utils/cloudinary.js";
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
      participants: userId
    });

    if (!chat) {
      throw new ApiError(404, "Chat not found or access denied");
    }

    // Build query for messages
    let messageQuery = {
      chat: chatId,
      "deleted.isDeleted": false
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
          select: "fullName username avatar "
        }
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments(messageQuery);

    // Mark messages as delivered
    const undeliveredMessages = messages.filter(
      message =>
        message.sender._id.toString() !== userId.toString() &&
        !message.deliveredTo.some(delivery => delivery.user.toString() === userId.toString())
    );

    for (const message of undeliveredMessages) {
      await message.markAsDelivered(userId);

      // Notify sender about delivery
      emitSocketEvent(req, message.sender._id.toString(), ChatEventsEnum.MESSAGE_DELIVERED_EVENT, {
        messageId: message._id,
        chatId,
        deliveredTo: userId,
        deliveredAt: new Date()
      });
    }

    const response = {
      messages: messages, // Removed reverse() - now newest first
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalMessages: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };

    return res.status(200).json(
      new ApiResponse(200, response, "Messages retrieved successfully")
    );
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
// export const sendMessage = asyncHandler(async (req, res) => {
//   try {


//     const { chatId } = req.params;
//     const userId = req.user.id;
//     const { content, type = "text", replyTo, isForwarded = false } = req.body;

//     // Validate required fields
//     if (!content && (!req.files || req.files.length === 0)) {
//       throw new ApiError(400, "Message content or media is required");
//     }

//     // Verify chat exists and user is participant
//     const chat = await Chat.findOne({
//       _id: chatId,
//       participants: userId
//     }).populate("participants", "_id");

//     if (!chat) {
//       throw new ApiError(404, "Chat not found or access denied");
//     }

//     // Check if replying to valid message
//     if (replyTo) {
//       const repliedMessage = await Message.findOne({
//         _id: replyTo,
//         chat: chatId,
//         "deleted.isDeleted": false
//       });

//       if (!repliedMessage) {
//         throw new ApiError(404, "Replied message not found");
//       }
//     }

//     let messageData = {
//       chat: chatId,
//       sender: userId,
//       type,
//       isForwarded
//     };

//     // Handle text messages
//     if (content && type === "text") {
//       messageData.content = { text: content.trim() };
//     }

//     // Handle media uploads
//     if (req.files && req.files.length > 0) {
//       const mediaFiles = [];

//       for (const file of req.files) {
//         try {
//           const uploadResult = await uploadOnCloudinary(file.path, "chat_media");

//           mediaFiles.push({
//             type: getMediaType(file.mimetype),
//             url: uploadResult.url,
//             publicId: uploadResult.public_id,
//             filename: file.originalname,
//             size: file.size
//           });
//         } catch (error) {
//           console.error("Media upload failed:", error);
//           throw new ApiError(500, "Failed to upload media files");
//         }
//       }

//       messageData.content = { media: mediaFiles };
//       messageData.type = mediaFiles[0].type;
//     }

//     // Add reply reference if exists
//     if (replyTo) {
//       messageData.replyTo = replyTo;
//     }

//     // Create message
//     const message = await Message.create(messageData);

//     // Populate message for response
//     await message.populate([
//       { path: "sender", select: "fullName username avatar" },
//       {
//         path: "replyTo",
//         populate: {
//           path: "sender",
//           select: "fullName username avatar"
//         }
//       }
//     ]);

//     // Update chat's last message
//     chat.lastMessage = message._id;
//     await chat.save();

//     // Emit socket event to the chat room only (removed individual participant emits to avoid duplicates)
//     emitSocketEvent(req, chatId, ChatEventsEnum.NEW_MESSAGE_EVENT, message);

//     return res.status(201).json(
//       new ApiResponse(201, message, "Message sent successfully")
//     );
//   } catch (error) {
//     return res
//       .status(500)
//       .json(new ApiResponse(500, null, "Internal Server Error"));

//   }
// });


export const sendMessage = asyncHandler(async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const { content, type = "text", replyTo, isForwarded = false } = req.body;

    if (!content && (!req.files || req.files.length === 0)) {
      throw new ApiError(400, "Message content or media is required");
    }

    console.log(`📨 Send message request:`, {
      chatId,
      userId,
      type,
      hasContent: !!content,
      hasFiles: !!(req.files && req.files.length > 0)
    });

    // ✅ Check chat exists and user is participant
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    }).populate("participants", "_id fullName deviceToken role");

    if (!chat) {
      throw new ApiError(404, "Chat not found or access denied");
    }

    // ✅ CRITICAL FIX: Validate session status before allowing message
    const activeSession = await ChatSession.findOne({
      chatId,
      $or: [
        { status: 'ACTIVE' },
        { status: 'ACCEPTED', astrologerId: userId } // Astrologers can send in ACCEPTED sessions
      ]
    });

    if (!activeSession) {
      throw new ApiError(400, "No active session found for this chat");
    }

    // Role-specific session validation
    if (req.user.role === 'user') {
      // Users can only send when session is ACTIVE
      if (activeSession.status !== 'ACTIVE') {
        throw new ApiError(400, "Session is not active. Please start the session to send messages.");
      }

      // Verify user is the session user
      if (activeSession.userId.toString() !== userId.toString()) {
        throw new ApiError(403, "Not authorized to send messages in this session");
      }
    } else if (req.user.role === 'astrologer') {
      // Astrologers can send when session is ACCEPTED or ACTIVE
      if (!['ACCEPTED', 'ACTIVE'].includes(activeSession.status)) {
        throw new ApiError(400, "Session is not active or accepted");
      }

      // Verify astrologer is the session astrologer
      if (activeSession.astrologerId.toString() !== userId.toString()) {
        throw new ApiError(403, "Not authorized to send messages in this session");
      }
    }

    console.log(`✅ Session validation passed:`, {
      sessionId: activeSession.sessionId,
      status: activeSession.status,
      userRole: req.user.role
    });

    // ✅ If reply message exists
    if (replyTo) {
      const repliedMessage = await Message.findOne({
        _id: replyTo,
        chat: chatId,
        "deleted.isDeleted": false,
      });

      if (!repliedMessage) {
        throw new ApiError(404, "Replied message not found");
      }
    }

    // ✅ Prepare message data
    let messageData = {
      chat: chatId,
      sender: userId,
      type,
      isForwarded,
    };

let textContent = "";

    if (content) {
      if (typeof content && typeof content === "object" && content.text !== undefined) {
        // New format: { content: { text: "..." } }
        textContent = typeof content.text === "string" ? content.text.trim() : "";
      } else if (typeof content === "string") {
        // Old format: { content: "..." }
        textContent = content.trim();
      }
    }

    if (textContent) {
      messageData.content = { text: textContent };
    }

    // ✅ Handle media files
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

    // ✅ Create message
    const message = await Message.create(messageData);

    // ✅ Populate sender details
    await message.populate([
      { path: "sender", select: "fullName username avatar role" },
      {
        path: "replyTo",
        populate: { path: "sender", select: "fullName username avatar" },
      },
    ]);

    // ✅ Update chat last message
    chat.lastMessage = message._id;
    await chat.save();

    // ✅ Update session last activity
    activeSession.lastActivityAt = new Date();
    await activeSession.save();

    // ✅ Prepare message data for socket emission
    const messageForSocket = {
      _id: message._id,
      content: message.content,
      type: message.type,
      sender: {
        _id: message.sender._id,
        username: message.sender.username,
        fullName: message.sender.fullName,
        avatar: message.sender.avatar,
        role: message.sender.role
      },
      chatId: chatId,
      replyTo: message.replyTo,
      isForwarded: message.isForwarded,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      readBy: [userId]
    };

    console.log(`📤 Emitting socket event for message:`, {
      messageId: message._id,
      chatId,
      sender: message.sender._id,
      content: content ? `${content.substring(0, 30)}...` : 'media'
    });

    // ✅ Emit real-time socket event to ALL chat participants
    emitSocketEvent(req, chatId, ChatEventsEnum.NEW_MESSAGE_EVENT, messageForSocket);

    console.log(`✅ Message sent and broadcasted successfully`);

    // ✅ Send push notifications to other participants
    const sender = message.sender;
    const receiverList = chat.participants.filter(
      (u) => u._id.toString() !== userId.toString()
    );

    // Send notifications asynchronously (don't wait for them)
    if (receiverList.length > 0) {
      receiverList.forEach(async (receiver) => {
        try {
          await sendNotification({
            userId: receiver._id,
            title: sender.fullName || "New Message",
            message:
              type === "text"
                ? content.length > 50 ? content.substring(0, 50) + '...' : content
                : type === "image"
                  ? "📸 Sent an image"
                  : type === "video"
                    ? "🎥 Sent a video"
                    : "📎 Sent a file",
            chatId,
            messageId: message._id,
            senderId: sender._id,
            senderName: sender.fullName,
            senderAvatar: sender.avatar,
            type: "chat_message",
          });
        } catch (notifError) {
          console.error("Notification error:", notifError);
          // Don't throw error, just log it
        }
      });
    }

    return res
      .status(201)
      .json(new ApiResponse(201, messageForSocket, "Message sent successfully"));

  } catch (error) {
    console.error("❌ Error in sendMessage:", {
      error: error.message,
      chatId: req.params.chatId,
      userId: req.user.id
    });

    // Re-throw ApiError instances, create new ones for other errors
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(500, "Failed to send message");
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
      deleteType
    };

    // For "forEveryone", replace content with deletion notice
    if (deleteType === "forEveryone") {
      message.content.text = "This message was deleted";
      message.content.media = [];
      message.type = "text";
    }

    await message.save();

    // Emit socket event
    emitSocketEvent(req, message.chat._id.toString(), ChatEventsEnum.MESSAGE_DELETED_EVENT, {
      messageId: message._id,
      chatId: message.chat._id,
      deletedBy: userId,
      deleteType
    });

    return res.status(200).json(
      new ApiResponse(200, null, "Message deleted successfully")
    );
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
      reaction => reaction.user.toString() !== userId.toString()
    );

    // Add new reaction
    message.reactions.push({
      user: userId,
      emoji,
      reactedAt: new Date()
    });

    await message.save();

    // Populate reaction user info
    await message.populate("reactions.user", "fullName username avatar");

    // Emit socket event
    emitSocketEvent(req, message.chat._id.toString(), ChatEventsEnum.MESSAGE_REACTION_EVENT, {
      messageId: message._id,
      reaction: message.reactions.find(r => r.user._id.toString() === userId.toString()),
      chatId: message.chat._id
    });

    return res.status(200).json(
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