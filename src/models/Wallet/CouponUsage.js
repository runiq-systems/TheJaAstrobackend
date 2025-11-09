import mongoose from 'mongoose';

const { Schema } = mongoose;

const CouponUsageSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
        txId: { type: String, required: true }, // which transaction used this coupon
        usageCount: { type: Number, default: 1 },
        status: { type: String, enum: ['USED', 'REVOKED'], default: 'USED' },
        usedAt: { type: Date, default: Date.now },
        meta: {
            amount: Number,
            discountValue: Number,
            description: String
        }
    },
    { timestamps: true }
);

CouponUsageSchema.index({ userId: 1, couponId: 1 }, { unique: true });

export default mongoose.model('CouponUsage', CouponUsageSchema);
