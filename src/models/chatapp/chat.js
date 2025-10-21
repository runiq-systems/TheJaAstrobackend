// models/chat.js
import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    // Chat identification
    name: {
      type: String,
      required: function() {
        return this.isGroupChat; // Required only for group chats
      },
      trim: true
    },
    
    // Chat type: one-on-one or group
    isGroupChat: {
      type: Boolean,
      default: false
    },
    
    // For one-on-one chats: store both participants
    participants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }],
    
    // For group chats: admin users
    admins: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    
    // Last message for preview
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    
    // Group chat avatar
    avatar: {
      url: String,
      publicId: String
    },
    
    // Group description
    description: {
      type: String,
      maxLength: 500
    },
    
    // Privacy settings for groups
    isPrivate: {
      type: Boolean,
      default: false
    },
    
    // Join requests for private groups
    joinRequests: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      requestedAt: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending"
      }
    }],
    
    // Custom settings
    settings: {
      allowInvites: {
        type: Boolean,
        default: true
      },
      onlyAdminsCanMessage: {
        type: Boolean,
        default: false
      },
      onlyAdminsCanEdit: {
        type: Boolean,
        default: true
      }
    }
  },
  {
    timestamps: true
  }
);

// Index for efficient querying
chatSchema.index({ participants: 1 });
chatSchema.index({ isGroupChat: 1, updatedAt: -1 });
chatSchema.index({ "joinRequests.user": 1 });

// Static method to find or create one-on-one chat
chatSchema.statics.findOrCreatePersonalChat = async function(user1Id, user2Id) {
  const chat = await this.findOne({
    isGroupChat: false,
    participants: { $all: [user1Id, user2Id], $size: 2 }
  }).populate("participants", "username avatar");
  
  if (chat) return chat;
  
  // Create new personal chat
  return this.create({
    isGroupChat: false,
    participants: [user1Id, user2Id]
  });
};

export const Chat = mongoose.model("Chat", chatSchema);