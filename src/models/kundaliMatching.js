import mongoose from 'mongoose';

const KundaliMatchingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  person1: {
    name: String,
    dob: String,
    tob: String,
    place: String,
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'KundaliReport' }
  },
  person2: {
    name: String,
    dob: String,
    tob: String,
    place: String,
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'KundaliReport' }
  },

  matchingReport: { type: Object, required: true }, // Full Prokerala response

  totalGuna: Number,
  result: String, // "Excellent", "Good", etc.

  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
}, { timestamps: true });

KundaliMatchingSchema.index({ userId: 1, "person1.reportId": 1, "person2.reportId": 1 }, { unique: true });

export const KundaliMatching = mongoose.model('KundaliMatching', KundaliMatchingSchema);