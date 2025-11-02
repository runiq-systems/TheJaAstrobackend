// models/WalletAudit.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const WalletAuditSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    txId: { type: String },
    action: { type: String, enum: ['CREDIT', 'DEBIT', 'RESERVE', 'UNRESERVE', 'ADMIN_ADJUST', 'COUPON_APPLY', 'REFUND'] },
    amount: { type: Number },
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
    note: { type: String },
    performedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true }
});

WalletAuditSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('WalletAudit', WalletAuditSchema);
