// models/Transaction.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const TransactionSchema = new Schema({
    txId: { type: String, required: true, unique: true, index: true }, // idempotency key
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    counterpartyId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // for transfers
    type: {
        type: String,
        enum: ['RECHARGE', 'DEDUCT', 'REFUND', 'TRANSFER', 'ADMIN_CREDIT', 'COUPON_BONUS', 'RESERVE', 'UNRESERVE', 'CHARGE_CAPTURE'],
        required: true
    },
    subtype: { type: String }, // e.g., 'CHAT','CALL','PAYMENT_GATEWAY'
    amount: { type: Number, required: true }, // positive integer paise
    fee: { type: Number, default: 0 },
    bonusAmount: { type: Number, default: 0 },
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'], default: 'PENDING', index: true },
    reason: { type: String },
    promoCode: { type: Schema.Types.ObjectId, ref: 'Coupon', default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now }
});

TransactionSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Transaction', TransactionSchema);
