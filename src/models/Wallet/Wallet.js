// models/Wallet.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const WalletSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    currency: { type: String, default: 'INR' },
    balance: { type: Number, default: 0 },      // store in smallest unit (paise)
    reserved: { type: Number, default: 0 },     // funds reserved for in-progress operations (paise)
    pendingIncoming: { type: Number, default: 0 }, // pending recharges (paise)
    totalEarned: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// keep wallet doc small & indexed
WalletSchema.index({ userId: 1 });

export default mongoose.model('Wallet', WalletSchema);
