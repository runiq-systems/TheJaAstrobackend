import mongoose from "mongoose";
const personSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  dob: {
    type: String, // "YYYY-MM-DD"
    required: true
  },
  tob: {
    type: String, // "HH:MM"
    required: true
  },
  place: {
    type: String,
    required: true,
    trim: true
  },
  coordinates: {
    latitude: Number,
    longitude: Number
  }
}, { _id: false });

const kundliMatchReportSchema = new mongoose.Schema({
  // Essential metadata
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Person details (we don't need to differentiate girl/boy in schema)
  person1: {
    type: personSchema,
    required: true
  },
  person2: {
    type: personSchema,
    required: true
  },
  
  // The complete API response stored as-is
  matchingReport: {
    type: mongoose.Schema.Types.Mixed, // or Object
    required: true
  },
  
  // Derived fields for quick access
  result: {
    type: String,
    enum: ['Excellent', 'Very Good', 'Good', 'Average', 'Poor', 'Very Poor'],
    default: 'Average'
  },  
  // Technical fields
  ayanamsa: {
    type: Number,
    enum: [1, 3, 5],
    default: 1
  },
  language: {
    type: String,
    enum: ['en'],
    default: 'en'
  },
  source: {
    type: String,
    enum: ['api', 'database'],
    default: 'api'
  },
  
  // Unique hash for deduplication
  match_hash: {
    type: String,
    unique: true,
    index: true
  },
  
  // Timestamps
  generatedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
  }
}, {
  timestamps: true,
  // Index for efficient queries
  indexes: [
    { 'person1.name': 1, 'person1.dob': 1 },
    { 'person2.name': 1, 'person2.dob': 1 },
    { userId: 1, generatedAt: -1 } // User's recent matches
  ]
});

// Pre-save hook to calculate hash and derived fields
kundliMatchReportSchema.pre('save', function(next) {
  // Calculate derived fields from matchingReport
  if (this.matchingReport) {
    // Extract total guna points
    if (this.matchingReport.data?.guna_milan?.total_points !== undefined) {
      this.totalGuna = this.matchingReport.data.guna_milan.total_points;
    } else if (this.matchingReport.guna_milan?.total_points !== undefined) {
      this.totalGuna = this.matchingReport.guna_milan.total_points;
    }
    
    // Determine result category
    this.result = determineResult(this.totalGuna);
    
    // Set compatibility flag (you can customize this logic)
    this.isCompatible = this.totalGuna >= 18; // Average or above
  }
  
  next();
});

// Helper function (can be in separate utils file)
function determineResult(totalPoints) {
  if (totalPoints >= 32) return 'Excellent';
  if (totalPoints >= 28) return 'Very Good';
  if (totalPoints >= 24) return 'Good';
  if (totalPoints >= 18) return 'Average';
  if (totalPoints >= 12) return 'Poor';
  return 'Very Poor';
}

export const KundaliMatching = mongoose.model('KundliMatching', kundliMatchReportSchema);