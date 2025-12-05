// models/call.js
import mongoose, { Schema } from "mongoose";

const CALL_TYPES = ["AUDIO", "VIDEO"];
const CALL_STATUSES = [
  "REQUESTED",
  "INITIATED",
  "RINGING",
  "CONNECTED",
  "COMPLETED",
  "MISSED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
];
const CALL_DIRECTIONS = ["USER_TO_ASTROLOGER", "ASTROLOGER_TO_USER"];

const callSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    callType: {
      type: String,
      enum: CALL_TYPES,
      required: true,
    },
    direction: {
      type: String,
      enum: CALL_DIRECTIONS,
      default: "USER_TO_ASTROLOGER",
      required: true,
    },
    status: {
      type: String,
      enum: CALL_STATUSES,
      default: "INITIATED",
      index: true,
    },

    startTime: { type: Date, default: Date.now, required: true },
    connectTime: { type: Date }, // when call is answered
    endTime: { type: Date },
    duration: { type: Number, default: 0 }, // in seconds

    chargesPerMinute: { type: Number, min: 0 }, // astrologer rate
    totalAmount: { type: Number, min: 0 },

    socketIds: {
      caller: String,
      receiver: String,
    },

    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, trim: true, maxlength: 300 },

    recordingUrl: {
      type: String,
      validate: {
        validator: (v) => !v || /^https?:\/\/.+/.test(v),
        message: "Invalid URL",
      },
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 3 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
callSchema.index({ userId: 1, startTime: -1 });
callSchema.index({ astrologerId: 1, startTime: -1 });
callSchema.index({ status: 1, createdAt: -1 });

// Virtual: is call active?
callSchema.virtual("isActive").get(function () {
  return ["INITIATED", "RINGING", "CONNECTED"].includes(this.status);
});

// Auto-calculate duration & amount
callSchema.pre("save", function (next) {
  if (this.endTime && this.startTime) {
    this.duration = Math.max(
      0,
      Math.floor((this.endTime - this.startTime) / 1000)
    );
  }
  if (this.chargesPerMinute && this.duration > 0) {
    this.totalAmount = Number(
      ((this.chargesPerMinute * this.duration) / 60).toFixed(2)
    );
  }
  if (this.isNew && this.status === "INITIATED") {
    this.expiresAt = new Date(Date.now() + 3 * 60 * 1000);
  }
  next();
});

// Instance methods
callSchema.methods = {
  markRinging() {
    this.status = "RINGING";
    return this.save();
  },
  markConnected() {
    this.status = "CONNECTED";
    this.connectTime = new Date();
    return this.save();
  },
  markEnded(status = "COMPLETED", endTime = new Date()) {
    this.status = status;
    this.endTime = endTime;
    return this.save();
  },
};

// Static methods
callSchema.statics = {
  findActiveCall(userId, partnerId) {
    return this.findOne({
      $or: [
        { userId, astrologerId: partnerId },
        { userId: partnerId, astrologerId: userId },
      ],
      status: { $in: ["INITIATED", "RINGING", "CONNECTED"] },
    });
  },
  getUserCallHistory(userId, limit = 10) {
    return this.find({
      $or: [{ userId }, { astrologerId: userId }],
      status: "COMPLETED",
    })
      .sort({ endTime: -1 })
      .limit(limit)
      .select("callType duration totalAmount rating createdAt");
  },
};

export const Call = mongoose.model("Call", callSchema);
