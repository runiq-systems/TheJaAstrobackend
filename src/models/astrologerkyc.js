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
export const kycSchema = new mongoose.Schema(
    {
        // Basic KYC Info
        panNumber: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
        },
        aadhaarNumber: {
            type: String,
            required: true,
            trim: true,
            minlength: 12,
            maxlength: 12,
        },

        // KYC Images
        panCardImage: {
            type: String,
            required: true,
        },
        aadhaarFrontImage: {
            type: String,
            required: true,
        },
        aadhaarBackImage: {
            type: String,
            required: true,
        },
        passbookImage: {
            type: String,
            required: true,
        },
        qualificationImage: {
            type: String,
            required: true,
        },

        // Bank Details Inside KYC
        bankDetails: {
            type: bankDetailsSchema,
            required: true,
        },

        // Verification
        kycVerified: {
            type: Boolean,
            default: false,
        },

        kycStatus: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },

        // Optional: Admin rejection reason
        rejectionReason: {
            type: String,
            default: "",
            trim: true,
        },
    },
    { timestamps: true }
);
