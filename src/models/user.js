import mongoose, { Schema } from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      sparse: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true, // Some users may log in with phone only
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
      index: true,
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
    UserStatus: {
      type: String,
      enum: ["Active", "InActive", "Blocked"],
      default: "inActive",
      index: true,
    },
    status: {
      type: String,
      enum: ["Online", "offline", "Busy"], // Allow only specific status values
      default: "offline", // Default t
      index: true,
    },
  },
  { timestamps: true }
);


export const User = mongoose.model("User", userSchema)