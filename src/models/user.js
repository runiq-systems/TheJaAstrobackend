import mongoose, { Schema } from "mongoose";
import { type } from "os";
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
      lowercase: true,
    },
    photo: {
      type: String
    },
    role: {
      type: String,
      enum: ['user', 'astrologer', 'admin'],
      default: 'user',
      require: true
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
    blockedUsers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [], // important to prevent undefined errors
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
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
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);