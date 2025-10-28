import mongoose, { Schema } from 'mongoose';

// Constants for better maintainability
const CALL_TYPES = ['AUDIO', 'VIDEO'];
const CALL_STATUSES = ['INITIATED', 'CONNECTED', 'COMPLETED', 'MISSED', 'REJECTED', 'FAILED', 'DISCONNECTED'];
const CALL_DIRECTIONS = ['USER_TO_ASTROLOGER', 'ASTROLOGER_TO_USER'];

const callSchema = new Schema(
  {
    // Core call participants
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    
    // Call timing
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
    
    // Call metadata
    callType: {
      type: String,
      enum: CALL_TYPES,
      required: true,
      index: true,
    },
    callDirection: {
      type: String,
      enum: CALL_DIRECTIONS,
      required: true,
    },
    status: {
      type: String,
      enum: CALL_STATUSES,
      default: 'INITIATED',
      index: true,
    },
    
    // Media features
    screenSharing: {
      enabled: {
        type: Boolean,
        default: false,
      },
      duration: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    
    // Post-call feedback
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
    
    // Financials
    charges: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      min: 0,
    },
    
    // Technical details
    recordingUrl: {
      type: String,
      trim: true,
      validate: {
        validator: function(url) {
          if (!url) return true;
          return /^https?:\/\/.+/.test(url);
        },
        message: 'Invalid recording URL format',
      },
    },
    socketIds: {
      caller: String,
      receiver: String,
    },
    webrtcStats: {
      type: Map,
      of: Schema.Types.Mixed,
    },
    
    


  
    
    // Notification preferences
    notificationPreferences: {
      incomingCalls: {
        type: Boolean,
        default: true,
      },
      missedCalls: {
        type: Boolean,
        default: true,
      },
      callEnded: {
        type: Boolean,
        default: true,
      },
      sound: {
        type: Boolean,
        default: true,
      },
      vibration: {
        type: Boolean,
        default: true,
      },
    },
    
    // For astrologers
    isAstrologer: {
      type: Boolean,
      default: false,
      index: true,
    },
    specialization: [{
      type: String,
    }],
    experience: {
      type: Number,
      default: 0,
    },
  
    totalCalls: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes for performance
callSchema.index({ userId: 1, astrologerId: 1, startTime: -1 });
callSchema.index({ status: 1, callType: 1 });
callSchema.index({ createdAt: -1 });
callSchema.index({ 'socketIds.caller': 1 });
callSchema.index({ 'socketIds.receiver': 1 });

// Virtual fields
callSchema.virtual('isCompleted').get(function() {
  return this.status === 'COMPLETED';
});

callSchema.virtual('isActive').get(function() {
  return ['INITIATED', 'CONNECTED'].includes(this.status);
});

// Pre-save middleware for auto-calculation
callSchema.pre('save', function(next) {
  if (this.endTime && this.startTime) {
    const diff = (this.endTime - this.startTime) / 1000;
    this.duration = Math.max(0, Math.round(diff));
    
    // Calculate total amount if charges per minute exist
    if (this.charges && this.duration > 0) {
      this.totalAmount = (this.charges * this.duration) / 60;
    }
  }
  next();
});

// Static methods
callSchema.statics = {
  async getActiveCallsByUser(userId) {
    return this.find({
      $or: [{ userId }, { astrologerId: userId }],
      status: { $in: ['INITIATED', 'CONNECTED'] },
    });
  },

  async getCompletedCalls(userId, limit = 20) {
    return this.find({ 
      $or: [{ userId }, { astrologerId: userId }],
      status: 'COMPLETED' 
    })
      .sort({ endTime: -1 })
      .limit(limit);
  },

  async findActiveCallBetweenUsers(userId1, userId2) {
    return this.findOne({
      $or: [
        { userId: userId1, astrologerId: userId2 },
        { userId: userId2, astrologerId: userId1 }
      ],
      status: { $in: ['INITIATED', 'CONNECTED'] }
    });
  },
};

// Instance methods
callSchema.methods = {
  markCompleted(endTime = new Date()) {
    this.endTime = endTime;
    this.status = 'COMPLETED';
    this.duration = Math.max(0, Math.round((endTime - this.startTime) / 1000));
    return this.save();
  },

  markConnected() {
    this.status = 'CONNECTED';
    return this.save();
  },

  markFailed(reason = 'Unknown error') {
    this.status = 'FAILED';
    this.feedback = reason;
    return this.save();
  },
};

export default mongoose.model('Call', callSchema);