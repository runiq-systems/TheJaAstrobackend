import mongoose from "mongoose";

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
            ref: "User", // Changed from Astrologer to User
            required: true,
            index: true
        },
        chatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Chat",
            required: true
        },

        // Session Pricing
        ratePerMinute: {
            type: Number,
            required: true,
            default: 10
        },
        currency: {
            type: String,
            default: "INR"
        },

        // Session Timing
        status: {
            type: String,
            enum: [
                "REQUESTED",      // User requested chat
                "WAITING",        // Waiting for astrologer acceptance
                "ACCEPTED",       // Astrologer accepted
                "ACTIVE",         // Chat ongoing
                "PAUSED",         // Chat paused (astrologer left)
                "COMPLETED",      // Session completed normally
                "REJECTED",       // Astrologer rejected
                "EXPIRED",        // Request expired
                "MISSED",         // Astrologer missed the request
                "CANCELLED"       // User cancelled before acceptance
            ],
            default: "REQUESTED",
            index: true
        },

        // Timing fields
        requestedAt: {
            type: Date,
            default: Date.now
        },
        acceptedAt: {
            type: Date
        },
        startedAt: {
            type: Date
        },
        endedAt: {
            type: Date
        },
        expiresAt: {
            type: Date,
            index: true
        },

        // Duration tracking
        totalDuration: {
            type: Number, // in seconds
            default: 0
        },
        billedDuration: {
            type: Number, // in seconds
            default: 0
        },
        lastActivityAt: {
            type: Date
        },

        // Billing information
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

        // Session tracking
        pauseIntervals: [{
            start: { type: Date, required: true },
            end: { type: Date },
            duration: { type: Number, default: 0 } // in seconds
        }],

        // User rating after session
        rating: {
            stars: { type: Number, min: 1, max: 5 },
            review: { type: String, maxlength: 500 },
            ratedAt: { type: Date }
        },

        // System fields
        autoExpire: {
            type: Boolean,
            default: true
        },
        timeoutDuration: {
            type: Number, // in seconds
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

// Indexes for efficient querying
chatSessionSchema.index({ userId: 1, status: 1 });
chatSessionSchema.index({ astrologerId: 1, status: 1 });
chatSessionSchema.index({ status: 1, expiresAt: 1 });

// Static method to generate session ID
chatSessionSchema.statics.generateSessionId = function () {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `CHAT_${timestamp}_${random}`.toUpperCase();
};

// Method to calculate current cost
chatSessionSchema.methods.calculateCurrentCost = function () {
    const minutes = Math.ceil(this.billedDuration / 60);
    return minutes * this.ratePerMinute;
};

// Method to check if session can be billed
chatSessionSchema.methods.canBill = function () {
    return this.status === "ACTIVE" || this.status === "PAUSED";
};

// Method to pause session
chatSessionSchema.methods.pauseSession = async function () {
    if (this.status !== "ACTIVE") return false;

    this.status = "PAUSED";
    this.pauseIntervals.push({
        start: new Date(),
        duration: 0
    });

    await this.save();
    return true;
};

// Method to resume session
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

// Method to complete session
chatSessionSchema.methods.completeSession = async function () {
    if (!["ACTIVE", "PAUSED"].includes(this.status)) return false;

    // Calculate final billing
    this.endedAt = new Date();
    this.status = "COMPLETED";

    // Calculate total duration
    if (this.startedAt) {
        this.totalDuration = Math.floor((this.endedAt - this.startedAt) / 1000);
    }

    // Calculate final cost
    const totalMinutes = Math.ceil(this.billedDuration / 60);
    this.totalCost = totalMinutes * this.ratePerMinute;

    // Calculate earnings (assuming 20% platform commission)
    this.platformCommission = this.totalCost * 0.20;
    this.astrologerEarnings = this.totalCost - this.platformCommission;

    await this.save();
    return true;
};

export const ChatSession = mongoose.model("ChatSession", chatSessionSchema);