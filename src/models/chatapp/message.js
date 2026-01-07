// models/message.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    // Reference to the chat
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true
    },
    
    // Message sender
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    // Message content (text, media, etc.)
    content: {
      text: {
        type: String,
        trim: true
      },
      media: [{
        type: { // image, video, audio, file, etc.
          type: String,
          enum: ["image", "video", "audio", "file", "sticker", "gif"]
        },
        url: String,
        publicId: String, // For cloud storage
        filename: String,
        size: Number,
        duration: Number, // For audio/video
        thumbnail: String // For video preview
      }]
    },
    
    // Message type
    type: {
      type: String,
      enum: [
        "text", 
        "image", 
        "video", 
        "audio", 
        "file", 
        "sticker", 
        "gif",
        "system" // For system messages like "user joined"
      ],
      default: "text"
    },
    
    // Message status
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent"
    },
    
    // Read receipts - who read the message and when
    readBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    // Delivery receipts - who received the message
    deliveredTo: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      deliveredAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    // Reply to another message
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    
    // Forwarded message info
    isForwarded: {
      type: Boolean,
      default: false
    },
    
    // Message reactions
    reactions: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      emoji: {
        type: String,
        required: true
      },
      reactedAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    // Message edits history
    edits: [{
      content: String,
      editedAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    // Delete info
    deleted: {
      isDeleted: {
        type: Boolean,
        default: false
      },
      deletedAt: Date,
      deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      deleteType: {
        type: String,
        enum: ["forMe", "forEveryone"]
      }
    },
    
    // System message metadata (for group events)
    systemMetadata: {
      action: {
        type: String,
        enum: ["user_joined", "user_left", "group_created", "user_removed", "admin_added", "admin_removed"]
      },
      targetUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }],
      performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ "readBy.user": 1 });
messageSchema.index({ "deliveredTo.user": 1 });

// Virtual for message preview
messageSchema.virtual("preview").get(function() {
  if (this.content.text) {
    return this.content.text.substring(0, 50) + (this.content.text.length > 50 ? "..." : "");
  }
  
  if (this.content.media && this.content.media.length > 0) {
    const mediaType = this.content.media[0].type;
    return `📎 ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}`;
  }
  
  return "System message";
});

// Method to mark message as delivered
messageSchema.methods.markAsDelivered = async function(userId) {
  if (!this.deliveredTo.some(delivery => delivery.user.toString() === userId.toString())) {
    this.deliveredTo.push({ user: userId });
    await this.save();
  }
};

// Method to mark message as read
messageSchema.methods.markAsRead = async function(userId) {
  if (!this.readBy.some(read => read.user.toString() === userId.toString())) {
    this.readBy.push({ user: userId });
    this.status = this.readBy.length > 0 ? "read" : "delivered";
    await this.save();
  }
};

messageSchema.methods.markAllAsRead = async function(userId) {
  const messages = await this.constructor.updateMany(
    {
      chat: this.chat,
      sender: { $ne: userId },
      "readBy.user": { $ne: userId }
    },
    {
      $addToSet: {
        readBy: { user: userId, readAt: new Date() }
      },
      $set: { status: "read" }
    }
  );
  return messages.modifiedCount;
};

export const Message = mongoose.model("Message", messageSchema);