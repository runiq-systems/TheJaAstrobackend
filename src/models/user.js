import mongoose, { Schema } from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      // lowercase: true,
      // trim: true,
      // index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    email: {
      type: String,
      lowercase: true,
    },
    dateOfBirth: {
      type: Date,
      required: false,
    },
    timeOfBirth: {
      type: String, // e.g., "14:30" in HH:MM format
      required: false,
    },
    isAccurate: {
      type: Boolean, // Indicates if birth time is accurate
      default: false,
    },
    placeOfBirth: {
      type: String, // e.g., "Nawāda, Bihar, India"
      trim: true,
    },
    password: {
      type: String,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
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
    },
    status: {
      type: String,
      enum: ["Online", "offline", "Busy"],
      default: "offline",
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    privacy: {
      lastSeen: {
        type: String,
        enum: ["everyone", "myContacts", "nobody"],
        default: "everyone",
      },
      profilePhoto: {
        type: String,
        enum: ["everyone", "myContacts", "nobody"],
        default: "everyone",
      },
      status: {
        type: String,
        enum: ["everyone", "myContacts", "nobody"],
        default: "everyone",
      },
    },
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    chatBackgrounds: [
      {
        chat: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Chat",
        },
        background: String,
      },
    ],
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);