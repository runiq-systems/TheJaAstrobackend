import mongoose from "mongoose";

const bankDetailsSchema = new mongoose.Schema({
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
});

const astrologerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
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
    yearOfExp: {
      type: Number,
      required: true,
      min: 0,
    },
    bio: {
      type: String,
      maxlength: 300,
    },
    description: {
      type: String,
      maxlength: 2000,
    },
    languages: [
      {
        type: String,
      },
    ],
    qualification: {
      type: String,
    },
    idProof: {
      type: {
        type: String,
      },
      number: {
        type: String,
      },
      documentUrl: {
        type: String,
      },
    },
    accountStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    bankDetails: {
      type: [bankDetailsSchema], // Array of bank details
      default: [], // Default to an empty array
    },
  },
  { timestamps: true }
);

export const Astrologer = mongoose.model("Astrologer", astrologerSchema)