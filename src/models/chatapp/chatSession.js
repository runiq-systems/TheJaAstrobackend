// models/chatapp/chatSession.js
import mongoose from "mongoose";
import { CommissionRule } from "../Wallet/AstroWallet.js";
const chatSessionSchema = new mongoose.Schema(
    {
        sessionId: {
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
        chatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Chat",
            required: true
        },

        // Enhanced Pricing
        ratePerMinute: {
            type: Number,
            required: true,
            default: 10
        },
        currency: {
            type: String,
            default: "INR"
        },
        minimumCharge: {
            type: Number,
            default: 10 // Minimum charge for 1 minute
        },

        // Enhanced Status Management
        status: {
            type: String,
            enum: [
                "REQUESTED",      // User requested chat
                "ACCEPTED",       // Astrologer accepted
                "ACTIVE",         // Chat ongoing
                "PAUSED",         // Chat paused
                "COMPLETED",      // Session completed
                "REJECTED",       // Astrologer rejected
                "EXPIRED",        // Request expired
                "CANCELLED",      // User cancelled
                "FAILED",          // Payment failed
                "AUTO_ENDED"

            ],
            default: "REQUESTED",
            index: true
        },

        // Enhanced Timing
        requestedAt: Date,
        acceptedAt: Date,
        startedAt: Date,
        endedAt: Date,
        lastActivityAt: Date,
        expiresAt: {
            type: Date,
            index: true
        },

        // Enhanced Duration Tracking
        totalDuration: {
            type: Number, // in seconds
            default: 0
        },
        billedDuration: {
            type: Number, // in seconds
            default: 0
        },
        activeDuration: {
            type: Number, // in seconds (excluding pauses)
            default: 0
        },

        // Enhanced Billing
        totalCost: {
            type: Number,
            default: 0
        },
        platformCommission: {
            type: Number,
            default: 0
        },
        astrologerEarnings: {
            type: Number,
            default: 0
        },
        taxAmount: {
            type: Number,
            default: 0
        },

        // Enhanced Session Management
        pauseIntervals: [{
            start: { type: Date, required: true },
            end: { type: Date },
            duration: { type: Number, default: 0 }
        }],

        // Payment & Reservation
        reservationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Reservation"
        },
        paymentStatus: {
            type: String,
            enum: [
                "PENDING",
                "RESERVED",
                "PAID",
                "FAILED",
                "FAILED_INSUFFICIENT_BALANCE",
                "FAILED_INVALID_RESERVATION",
                "FAILED_INVALID_REFERENCES",
                "FAILED_RESERVATION_NOT_FOUND",
                "FAILED_INVALID_RESERVATION_STATE",
                "NO_RESERVATION", // Add this
                "CANCELLED",
                "REFUNDED"
            ],
            default: "PENDING"
        },

        // User Experience
        userRating: {
            stars: { type: Number, min: 1, max: 5 },
            review: { type: String, maxlength: 500 },
            ratedAt: { type: Date }
        },

        // System
        autoExpire: {
            type: Boolean,
            default: true
        },
        timeoutDuration: {
            type: Number,
            default: 300 // 5 minutes
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
chatSessionSchema.index({ userId: 1, status: 1 });
chatSessionSchema.index({ astrologerId: 1, status: 1 });
chatSessionSchema.index({ status: 1, expiresAt: 1 });
chatSessionSchema.index({ "meta.requestId": 1 });

// Static Methods
chatSessionSchema.statics.generateSessionId = function () {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `CHAT_${timestamp}_${random}`.toUpperCase();
};

chatSessionSchema.statics.findActiveSession = function (userId, astrologerId) {
    return this.findOne({
        userId,
        astrologerId,
        status: { $in: ["REQUESTED", "ACCEPTED", "ACTIVE", "PAUSED"] }
    });
};


// Find expired sessions that need to be marked
chatSessionSchema.statics.findExpiredSessions = function () {
    const now = new Date();
    return this.find({
        expiresAt: { $lt: now },
        status: { $in: ["REQUESTED"] },
        autoExpired: { $ne: true } // Only get sessions not already marked as auto-expired
    });
};

// Mark session as expired (to be called by a cron job or similar)
chatSessionSchema.statics.markExpiredSessions = async function () {
    try {
        const expiredSessions = await this.findExpiredSessions();

        const result = await this.updateMany(
            {
                _id: { $in: expiredSessions.map(s => s._id) }
            },
            {
                $set: {
                    status: "EXPIRED",
                    endedAt: new Date(),
                    autoExpired: true,
                    lastActivityAt: new Date()
                }
            }
        );

        return result;
    } catch (error) {
        console.error("Error marking expired sessions:", error);
        throw error;
    }
};


chatSessionSchema.methods.shouldBeExpired = function () {
    // Only REQUESTED sessions can expire
    if (this.status !== "REQUESTED") return false;

    if (!this.expiresAt) return false;

    return new Date() > this.expiresAt;
};

chatSessionSchema.methods.isExpired = function () {
    return this.expiresAt && new Date() > this.expiresAt;
};

// Instance Methods
chatSessionSchema.methods.calculateCurrentCost = function () {
    const billedMinutes = Math.ceil(this.billedDuration / 60);
    return Math.max(this.minimumCharge, billedMinutes * this.ratePerMinute);
};

chatSessionSchema.methods.canStart = function () {
    return this.status === "ACCEPTED" && !this.isExpired();
};

chatSessionSchema.methods.isExpired = function () {
    return this.expiresAt && new Date() > this.expiresAt;
};

chatSessionSchema.methods.pauseSession = async function () {
    if (this.status !== "ACTIVE") return false;

    this.status = "PAUSED";
    this.pauseIntervals.push({
        start: new Date(),
        duration: 0
    });
    this.lastActivityAt = new Date();

    await this.save();
    return true;
};

chatSessionSchema.methods.resumeSession = async function () {
    if (this.status !== "PAUSED") return false;

    const currentPause = this.pauseIntervals[this.pauseIntervals.length - 1];
    if (currentPause && !currentPause.end) {
        currentPause.end = new Date();
        currentPause.duration = Math.floor((currentPause.end - currentPause.start) / 1000);
    }

    this.status = "ACTIVE";
    this.lastActivityAt = new Date();

    await this.save();
    return true;
};

chatSessionSchema.methods.completeSession = async function () {
    if (!["ACTIVE", "PAUSED"].includes(this.status)) return false;

    this.endedAt = new Date();
    this.status = "COMPLETED";

    // Calculate total duration
    if (this.startedAt) {
        this.totalDuration = Math.floor((this.endedAt - this.startedAt) / 1000);
    }

    // Calculate active duration (excluding pauses)
    const totalPauseDuration = this.pauseIntervals.reduce((total, interval) => {
        return total + (interval.duration || 0);
    }, 0);

    this.activeDuration = this.totalDuration - totalPauseDuration;

    // Calculate final billing (use active duration for billing)
    const billedMinutes = Math.ceil(this.billedDuration / 60);
    this.totalCost = Math.max(this.minimumCharge, billedMinutes * this.ratePerMinute);
    // Simple commission fetch - just get the first active chat commission rule
    const commissionRule = await CommissionRule.findOne({
        isActive: true,
        $or: [
            { "conditions.sessionType": "CHAT" },
            { "conditions.sessionType": { $size: 0 } } // Or rules that apply to all session types
        ]
    }).lean();

    // Set commission rate (default to 20% if no rule found)
    const commissionRate = commissionRule ?
        Number(commissionRule.commissionValue) / 100 : 0.20;
    const taxRate = 0.18;

    const baseAmount = this.totalCost;
    this.platformCommission = baseAmount * commissionRate;
    this.taxAmount = baseAmount * taxRate;
    this.astrologerEarnings = baseAmount - this.platformCommission - this.taxAmount;

    await this.save();
    return true;
};

// Middleware
chatSessionSchema.pre("save", function (next) {
    if (this.isModified("status") && this.status === "ACTIVE" && !this.startedAt) {
        this.startedAt = new Date();
    }
    next();
});

export const ChatSession = mongoose.model("ChatSession", chatSessionSchema);