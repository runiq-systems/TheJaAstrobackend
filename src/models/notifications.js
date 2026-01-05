import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  type: {
    type: String,
    enum: ['info', 'alert', 'success', 'reminder'],
    default: 'info'
  },
  // For sending to specific users or all users
  targetUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isForAllUsers: {
    type: Boolean,
    default: false
  },
  targetRoles: [{
    type: String,
    enum: ['user', 'astrologer', 'admin']
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  sentAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Notifications expire after 30 days by default
      const date = new Date();
      date.setDate(date.getDate() + 30);
      return date;
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for faster queries
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ isActive: 1 });
notificationSchema.index({ isForAllUsers: 1 });
notificationSchema.index({ targetUsers: 1 });
notificationSchema.index({ sentAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);