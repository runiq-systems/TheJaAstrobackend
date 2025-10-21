import mongoose, { Schema } from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    email: {
      type: String,
      // unique: true,
      // sparse: true, // Some users may log in with phone only
      lowercase: true,
    },
    dateOfBirth: {
      type: Date,
      required: false,
    },
    password: {
      type: String,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"], // Enum for gender values
      // index: true,
    },
    languages: [
      {
        type: String,
      },
    ],
    deviceToken: {
      type: String,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isSuspend: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
    },
    otpExpires: {
      type: Date,
    },
    refreshToken: {
      type: String,
    },
    userStatus: {
      type: String,
      enum: ["Active", "InActive", "Blocked"],
      default: "InActive",
      // index: true,
    },
    status: {
      type: String,
      enum: ["Online", "offline", "Busy"], // Allow only specific status values
      default: "offline", // Default t
      // index: true,
    },

    isOnline: {
      type: Boolean,
      default: false
    },

    // Last seen
    lastSeen: {
      type: Date,
      default: Date.now
    },

    // Privacy settings
    privacy: {
      lastSeen: {
        type: String,
        enum: ["everyone", "myContacts", "nobody"],
        default: "everyone"
      },
      profilePhoto: {
        type: String,
        enum: ["everyone", "myContacts", "nobody"],
        default: "everyone"
      },
      status: {
        type: String,
        enum: ["everyone", "myContacts", "nobody"],
        default: "everyone"
      }
    },

    // Blocked users
    blockedUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],

    // Chat background preferences
    chatBackgrounds: [{
      chat: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Chat"
      },
      background: String
    }]

  },
  { timestamps: true }
);


export const User = mongoose.model("User", userSchema)