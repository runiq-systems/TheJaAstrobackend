import { Message } from "../../models/chatapp/message.js";
import { Chat } from "../../models/chatapp/chat.js";
import { User } from "../../models/user.js";
import { ApiError} from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { emitSocketEvent } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import { uploadOnCloudinary ,deleteFromCloudinary} from "../../utils/cloudinary.js";

/**
 * @desc    Get all messages in a chat
 * @route   GET /api/v1/messages/:chatId
 * @access  Private
 */
export const getAllMessages = asyncHandler(async (req, res) => {
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
        select: "fullName username avatar"
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
});

/**
 * @desc    Send a message
 * @route   POST /api/v1/messages/:chatId
 * @access  Private
 */
export const sendMessage = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  const { content, type = "text", replyTo, isForwarded = false } = req.body;

  // Validate required fields
  if (!content && (!req.files || req.files.length === 0)) {
    throw new ApiError(400, "Message content or media is required");
  }

  // Verify chat exists and user is participant
  const chat = await Chat.findOne({
    _id: chatId,
    participants: userId
  }).populate("participants", "_id");

  if (!chat) {
    throw new ApiError(404, "Chat not found or access denied");
  }

  // Check if replying to valid message
  if (replyTo) {
    const repliedMessage = await Message.findOne({
      _id: replyTo,
      chat: chatId,
      "deleted.isDeleted": false
    });
    
    if (!repliedMessage) {
      throw new ApiError(404, "Replied message not found");
    }
  }

  let messageData = {
    chat: chatId,
    sender: userId,
    type,
    isForwarded
  };

  // Handle text messages
  if (content && type === "text") {
    messageData.content = { text: content.trim() };
  }

  // Handle media uploads
  if (req.files && req.files.length > 0) {
    const mediaFiles = [];
    
    for (const file of req.files) {
      try {
        const uploadResult = await uploadOnCloudinary(file.path, "chat_media");
        
        mediaFiles.push({
          type: getMediaType(file.mimetype),
          url: uploadResult.url,
          publicId: uploadResult.public_id,
          filename: file.originalname,
          size: file.size
        });
      } catch (error) {
        console.error("Media upload failed:", error);
        throw new ApiError(500, "Failed to upload media files");
      }
    }
    
    messageData.content = { media: mediaFiles };
    messageData.type = mediaFiles[0].type;
  }

  // Add reply reference if exists
  if (replyTo) {
    messageData.replyTo = replyTo;
  }

  // Create message
  const message = await Message.create(messageData);

  // Populate message for response
  await message.populate([
    { path: "sender", select: "fullName username avatar" },
    { 
      path: "replyTo",
      populate: {
        path: "sender",
        select: "fullName username avatar"
      }
    }
  ]);

  // Update chat's last message
  chat.lastMessage = message._id;
  await chat.save();

  // Emit socket event to the chat room only (removed individual participant emits to avoid duplicates)
  emitSocketEvent(req, chatId, ChatEventsEnum.NEW_MESSAGE_EVENT, message);

  return res.status(201).json(
    new ApiResponse(201, message, "Message sent successfully")
  );
});

/**
 * @desc    Delete a message
 * @route   DELETE /api/v1/messages/:messageId
 * @access  Private
 */
export const deleteMessage = asyncHandler(async (req, res) => {
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
});

/**
 * @desc    React to a message
 * @route   PUT /api/v1/messages/:messageId/react
 * @access  Private
 */
export const reactToMessage = asyncHandler(async (req, res) => {
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
});

// Helper function to determine media type
const getMediaType = (mimetype) => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "file";
};