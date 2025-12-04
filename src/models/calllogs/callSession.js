// models/callapp/callSession.model.js
import mongoose from "mongoose";

const callSessionSchema = new mongoose.Schema(
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
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      required: true,
      index: true
    },

    // Call Type
    callType: {
      type: String,
      enum: ["AUDIO", "VIDEO"],
      required: true,
      uppercase: true
    },

    // Pricing
    ratePerMinute: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: "INR"
    },
    minimumCharge: {
      type: Number,
      default: 50 // e.g., min 1 min charge
    },

    // Enhanced Status Management
    status: {
      type: String,
      enum: [
        "REQUESTED",     // User initiated call
        "ACCEPTED",      // Astrologer accepted → ringing
        "RINGING",       // User side ringing
        "CONNECTED",     // Both joined → billing starts
        "ACTIVE",        // Same as CONNECTED (kept for consistency)
        "ON_HOLD",       // Call on hold (rare, but possible)
        "COMPLETED",     // Normal end
        "REJECTED",
        "MISSED",
        "CANCELLED",
        "FAILED",        // Network, payment, crash
        "EXPIRED",
        "AUTO_ENDED"
      ],
      default: "REQUESTED",
      index: true
    },

    // Timing
    requestedAt: { type: Date, default: Date.now },
    acceptedAt: Date,
    ringingAt: Date,
    connectedAt: Date,    // When call actually connects (billing starts)
    endedAt: Date,
    lastActivityAt: Date,
    expiresAt: {
      type: Date,
      index: true
    },

    // Duration Tracking (in seconds)
    totalDuration: { type: Number, default: 0 },     // From connect → end
    billedDuration: { type: Number, default: 0 },     // What user is charged for
    holdDuration: { type: Number, default: 0 },       // If on hold

    // Billing
    totalCost: { type: Number, default: 0 },
    platformCommission: { type: Number, default: 0 },
    astrologerEarnings: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },

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
        "NO_RESERVATION",
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

    // Call Quality & Tech
    networkQuality: {
      type: String,
      enum: ["excellent", "good", "poor", "bad"],
      default: "good"
    },
    recordingUrl: String,
    socketIds: {
      caller: String,
      receiver: String
    },

    // System
    autoExpire: { type: Boolean, default: true },
    timeoutDuration: { type: Number, default: 180 }, // 3 mins ringing

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
      // e.g., { requestId, deviceInfo, ip, userAgent, platform: "android" }
    }
  },
  {
    timestamps: true
  }
);

// ────────────────────────────── Indexes ──────────────────────────────
callSessionSchema.index({ userId: 1, status: 1 });
callSessionSchema.index({ astrologerId: 1, status: 1 });
callSessionSchema.index({ status: 1, expiresAt: 1 });
callSessionSchema.index({ callId: 1 });
callSessionSchema.index({ "meta.requestId": 1 });

// ────────────────────────────── Statics ──────────────────────────────
callSessionSchema.statics.generateSessionId = function () {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 8).toUpperCase();
  return `CALL_${timestamp}_${random}`;
};

callSessionSchema.statics.findActiveCallSession = function (userId, astrologerId) {
  return this.findOne({
    $or: [{ userId }, { astrologerId: userId }],
    astrologerId: astrologerId || this.astrologerId,
    status: { $in: ["REQUESTED", "ACCEPTED", "RINGING", "CONNECTED", "ACTIVE"] }
  });
};

// ────────────────────────────── Methods ──────────────────────────────
callSessionSchema.methods.calculateCurrentCost = function () {
  const minutes = Math.ceil(this.billedDuration / 60);
  return Math.max(this.minimumCharge, minutes * this.ratePerMinute);
};

callSessionSchema.methods.isExpired = function () {
  return this.expiresAt && new Date() > this.expiresAt;
};

callSessionSchema.methods.completeSession = async function () {
  if (!["CONNECTED", "ACTIVE"].includes(this.status)) return false;

  this.endedAt = new Date();
  this.status = "COMPLETED";

  // Total connect duration
  if (this.connectedAt) {
    this.totalDuration = Math.floor((this.endedAt - this.connectedAt) / 1000);
  }

  this.billedDuration = this.totalDuration; // calls usually bill full connected time

  // Final cost
  const billedMinutes = Math.ceil(this.billedDuration / 60);
  this.totalCost = Math.max(this.minimumCharge, billedMinutes * this.ratePerMinute);

  // Commission & Tax (same as chat)
  const commissionRate = 0.20;
  const taxRate = 0.18;
  const base = this.totalCost;

  this.platformCommission = base * commissionRate;
  this.taxAmount = base * taxRate;
  this.astrologerEarnings = base - this.platformCommission - this.taxAmount;

  await this.save();
  return true;
};

// Auto-set connectedAt when status becomes CONNECTED
callSessionSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "CONNECTED" && !this.connectedAt) {
    this.connectedAt = new Date();
  }
  if (this.isModified("status") && ["ACCEPTED", "RINGING"].includes(this.status) && !this.ringingAt) {
    this.ringingAt = new Date();
  }
  next();
});

export const CallSession = mongoose.model("CallSession", callSessionSchema);