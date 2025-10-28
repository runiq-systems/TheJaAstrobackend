import { Schema, model } from 'mongoose';

// Helper: Common Enums for standardization
const CALL_TYPES = ['AUDIO', 'VIDEO'];
const CALL_STATUSES = ['INITIATED', 'CONNECTED', 'COMPLETED', 'MISSED', 'FAILED'];

// Main Schema
const callSchema = new Schema(
  {

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, // query optimization
    },
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number,
      default: 0, // duration in seconds
      min: 0,
    },
    callType: {
      type: String,
      enum: CALL_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: CALL_STATUSES,
      default: 'INITIATED',
      index: true,
    },
    screenSharing: {
      enabled: {
        type: Boolean,
        default: false,
      },
      duration: {
        type: Number,
        default: 0, // in seconds
        min: 0,
      },
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    feedback: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    charges: {
      type: Number,
      required: true,
      min: 0,
    },
    recordingUrl: {
      type: String,
      trim: true,
      validate: {
        validator: function (url) {
          if (!url) return true;
          return /^https?:\/\/.+/.test(url);
        },
        message: 'Invalid recording URL format',
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

//
// 🔹 Index Combinations for Scalability
//
callSchema.index({ userId: 1, astrologerId: 1, startTime: -1 });
callSchema.index({ status: 1, callType: 1 });
callSchema.index({ createdAt: -1 });

//
// 🔹 Virtual Fields
//
callSchema.virtual('isCompleted').get(function () {
  return this.status === 'COMPLETED';
});

//
// 🔹 Pre-save Hook to Auto-calculate Duration
//
callSchema.pre('save', function (next) {
  if (this.endTime && this.startTime) {
    const diff = (this.endTime - this.startTime) / 1000;
    this.duration = Math.max(0, Math.round(diff));
  }
  next();
});

//
// 🔹 Static Methods (Reusable Business Logic)
//
callSchema.statics = {
  async getActiveCallsByUser(userId) {
    return this.find({
      userId,
      status: { $in: ['INITIATED', 'CONNECTED'] },
    });
  },

  async getCompletedCalls(astrologerId, limit = 20) {
    return this.find({ astrologerId, status: 'COMPLETED' })
      .sort({ endTime: -1 })
      .limit(limit);
  },
};

//
// 🔹 Instance Methods (Instance-level operations)
//
callSchema.methods = {
  markCompleted(endTime = new Date()) {
    this.endTime = endTime;
    this.status = 'COMPLETED';
    this.duration = Math.max(0, Math.round((endTime - this.startTime) / 1000));
    return this.save();
  },
};

//
// 🔹 Plugin Example (for Auditing, Soft Delete, etc.)
//   Uncomment when needed
//
// import mongooseDelete from 'mongoose-delete';
// callSchema.plugin(mongooseDelete, { deletedAt: true, overrideMethods: 'all' });

//
// 🔹 Export
//
const Call = model('Call', callSchema);
export default Call;
