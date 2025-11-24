import mongoose from "mongoose";

const chatRequestSchema = new mongoose.Schema(
    {
        requestId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        astrologerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // Changed from Astrologer to User
            required: true,
            index: true
        },

        // Request details
        status: {
            type: String,
            enum: [
                "PENDING",      // Waiting for astrologer response
                "ACCEPTED",     // Astrologer accepted
                "REJECTED",     // Astrologer rejected
                "EXPIRED",      // Request timed out
                "CANCELLED",    // User cancelled
                "MISSED"        // Astrologer didn't respond in time
            ],
            default: "PENDING",
            index: true
        },

        // Timing
        requestedAt: {
            type: Date,
            default: Date.now
        },
        respondedAt: {
            type: Date
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true
        },

        // Session reference (if accepted)
        sessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ChatSession"
        },

        // Additional info
        userMessage: {
            type: String,
            maxlength: 500
        },

        meta: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

// Indexes
chatRequestSchema.index({ astrologerId: 1, status: 1 });
chatRequestSchema.index({ status: 1, expiresAt: 1 });

// Static method to generate request ID
chatRequestSchema.statics.generateRequestId = function () {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `REQ_${timestamp}_${random}`.toUpperCase();
};

// Method to check if request is expired
chatRequestSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

export const ChatRequest = mongoose.model("ChatRequest", chatRequestSchema);