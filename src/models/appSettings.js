// models/AppSettings.ts
import mongoose from "mongoose";
const AppSettingsSchema = new mongoose.Schema(
  {
    supportEmail: {
      type: String,
      default: 'info@thejaastro.com',
      trim: true,
      validate: {
        validator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: 'Invalid email format',
      },
    },
    supportPhone: {
      type: String,
      default: '+91 98765 43210',
      trim: true,
    },
    minWalletBalance: {
      type: Number,
      default: 100,
      min: 0,
    },
    maxWalletBalance: {
      type: Number,
      default: 5000,
      min: 0,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure minWalletBalance <= maxWalletBalance
AppSettingsSchema.pre('save', function (next) {
  if (this.minWalletBalance > this.maxWalletBalance) {
    return next(new Error('Minimum wallet balance cannot exceed maximum wallet balance'));
  }
  next();
});

export const AppSettings = mongoose.model('AppSettings', AppSettingsSchema);