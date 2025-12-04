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
                "AUTO_ENDED"    // System ended (e.g. low balance, crash)
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
        respondedAt: { type: Date },           // When astrologer accepted/rejected
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }               // Auto-delete after expiry (optional)
        },

        // Linked Call Session (created immediately or on accept)
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
            // e.g., { socketId, deviceInfo, ip, userAgent }
        }
    },
    {
        timestamps: true
    }
);

// ──────────────────────────────────────────────────────────────
// Indexes for Performance & Auto-cleanup
// ──────────────────────────────────────────────────────────────
callRequestSchema.index({ astrologerId: 1, status: 1 });
callRequestSchema.index({ userId: 1, status: 1 });
callRequestSchema.index({ status: 1, expiresAt: 1 });
callRequestSchema.index({ callId: 1 });

// ──────────────────────────────────────────────────────────────
// Static: Generate unique request ID
// ──────────────────────────────────────────────────────────────
callRequestSchema.statics.generateRequestId = function () {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `CALL_${timestamp}_${random}`;
};

// ──────────────────────────────────────────────────────────────
// Instance method: Check if expired
// ──────────────────────────────────────────────────────────────
callRequestSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

// ──────────────────────────────────────────────────────────────
// Optional: Auto-mark as MISSED on expiry (via cron or TTL)
// ──────────────────────────────────────────────────────────────
callRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// If you want MongoDB to auto-delete expired requests after 24h:
// callRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const CallRequest = mongoose.model("CallRequest", callRequestSchema);