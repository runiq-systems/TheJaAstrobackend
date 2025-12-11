import mongoose from "mongoose";
import { kycSchema } from "./astrologerkyc.js";

export const bankDetailsSchema = new mongoose.Schema({
  bankName: {
    type: String,
    required: true,
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true, // Ensures account numbers are unique across all entries
  },
  ifscCode: {
    type: String,
    required: true,
  },
  accountHolderName: {
    type: String,
    required: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  }
});

const astrologerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    photo: {
      type: String,
      default: "",
    },
    specialization: [
      {
        type: String,
      },
    ],

    yearOfExpertise: {
      type: String,
    },
    yearOfExperience: {
      type: String,
    },
    bio: {
      type: String,
      maxlength: 300,
    },
    description: {
      type: String,
      maxlength: 2000,
    },
    ratepermin: {
      type: Number,
      default: 5
    },
    rank: {
      type: Number,
      default: null
    },
    languages: {
      type: [String],
      default: ["Hindi"],
    },

    qualification: {
      type: String,
    },
    astrologerApproved: {
      type: Boolean,
      default: false,
    },
    accountStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    isProfilecomplet: {
      type: Boolean,
      default: false,
    },
    bankDetails: {
      type: [bankDetailsSchema], // Array of bank details
      default: [], // Default to an empty array
    },
    kyc: {
      type: kycSchema,
      default: null,
    },
  },
  { timestamps: true }
);


astrologerSchema.index({ rank: 1 });           // Rank sorting very fast
astrologerSchema.index({ astrologerApproved: 1 });
astrologerSchema.index({ accountStatus: 1 });
astrologerSchema.index({ userId: 1 });

export const Astrologer = mongoose.model("Astrologer", astrologerSchema)