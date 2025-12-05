// models/callRequest.model.js
import mongoose from "mongoose";

const callRequestSchema = new mongoose.Schema(
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
            ref: "User",
            required: true,
            index: true
        },
        
        // === ADD THIS: Link to CallSession ===
        sessionId: {
            type: String,
            ref: "CallSession",
            index: true
        },

        // Call-specific
        callType: {
            type: String,
            enum: ["AUDIO", "VIDEO"],
            required: true,
            uppercase: true
        },

        // Request status
        status: {
            type: String,
            enum: [
                "PENDING",      // Waiting for astrologer to accept/reject
                "ACCEPTED",     // Astrologer accepted → ringing
                "REJECTED",     // Astrologer rejected
                "EXPIRED",      // 3-minute timeout
                "CANCELLED",    // User cancelled before answer
                "MISSED",       // Astrologer didn't respond in time
                "AUTO_ENDED",   // System ended
                "COMPLETED"     // Call completed successfully
            ],
            default: "PENDING",
            index: true
        },

        // Timing
        requestedAt: {
            type: Date,
            default: Date.now,
            index: true
        },
        respondedAt: { type: Date },
        expiresAt: {
            type: Date,
            required: true,
            index: true
        },

        // Linked Call Session
        callId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Call",
            index: true
        },

        // Optional user message
        userMessage: {
            type: String,
            trim: true,
            maxlength: 300
        },

        // Rate & metadata
        ratePerMinute: {
            type: Number,
            required: true,
            min: 0
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
callRequestSchema.index({ astrologerId: 1, status: 1 });
callRequestSchema.index({ userId: 1, status: 1 });
callRequestSchema.index({ status: 1, expiresAt: 1 });
callRequestSchema.index({ callId: 1 });
callRequestSchema.index({ sessionId: 1 }); // Add this index

// Statics
callRequestSchema.statics.generateRequestId = function () {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `CALL_${timestamp}_${random}`;
};

// Methods
callRequestSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

callRequestSchema.methods.getTimeRemaining = function () {
    const remaining = this.expiresAt - new Date();
    return Math.max(0, Math.floor(remaining / 1000)); // seconds
};

export const CallRequest = mongoose.model("CallRequest", callRequestSchema);