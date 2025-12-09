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

    // === ADD THIS: Link back to CallRequest ===
    requestId: {
      type: String,
      ref: "CallRequest",
      index: true
    },

    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
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
      default: 50
    },

    // Status
    status: {
      type: String,
      enum: [
        "REQUESTED",     // User initiated call
        "ACCEPTED",      // Astrologer accepted
        "RINGING",       // User side ringing
        "CONNECTED",     // Both joined → billing starts
        "ACTIVE",        // Call ongoing
        "ON_HOLD",       // Call paused
        "COMPLETED",     // Normal end
        "REJECTED",
        "MISSED",
        "CANCELLED",
        "FAILED",
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
    connectedAt: Date,
    endedAt: Date,
    lastActivityAt: Date,
    expiresAt: {
      type: Date,
      index: true
    },

    // Duration Tracking
    totalDuration: { type: Number, default: 0 },
    billedDuration: { type: Number, default: 0 },
    holdDuration: { type: Number, default: 0 },

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
    // In your CallSession schema — add this line
    networkDropHandled: { type: Boolean, default: false },
    // Meta
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
callSessionSchema.index({ userId: 1, status: 1 });
callSessionSchema.index({ astrologerId: 1, status: 1 });
callSessionSchema.index({ status: 1, expiresAt: 1 });
callSessionSchema.index({ callId: 1 });
callSessionSchema.index({ requestId: 1 });

// Statics
callSessionSchema.statics.generateSessionId = function () {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 8).toUpperCase();
  return `CALL_${timestamp}_${random}`;
};

callSessionSchema.statics.findByRequestId = function (requestId) {
  return this.findOne({ requestId });
};

// Methods
callSessionSchema.methods.calculateCurrentCost = function () {
  const minutes = Math.ceil(this.billedDuration / 60);
  return Math.max(this.minimumCharge, minutes * this.ratePerMinute);
};

callSessionSchema.methods.isExpired = function () {
  return this.expiresAt && new Date() > this.expiresAt;
};

export const CallSession = mongoose.model("CallSession", callSessionSchema);