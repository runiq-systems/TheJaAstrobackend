import mongoose from 'mongoose';

const KundaliReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Birth details (for easy display in "Saved Kundali")
  name: { type: String, required: true },
  dob: { type: String, required: true }, // "1994-06-12"
  tob: { type: String, required: true }, // "08:35"
  place: { type: String, required: true },
  coordinates: { lat: Number, lon: Number },

  // Cached API response
  report: { type: Object, required: true }, // Full Prokerala response.data.data

  ayanamsa: { type: Number, default: 1 },
  language: { type: String, default: 'en' },

  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } // 30 days
}, { timestamps: true });

KundaliReportSchema.index({ userId: 1, dob: 1, tob: 1, place: 1 }, { unique: true });

export const KundaliReport =  mongoose.model('KundaliReport', KundaliReportSchema);