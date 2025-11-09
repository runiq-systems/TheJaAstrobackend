// models/Coupon.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const CouponSchema = new Schema({
    code: { type: String, required: true, unique: true, index: true }, // e.g., FIRST100
    description: { type: String },
    discountType: { type: String, enum: ['PERCENTAGE', 'FIXED', 'BONUS_PERCENTAGE', 'CASHBACK_PERCENTAGE'], required: true },
    value: { type: Number, required: true }, // percentage or fixed paise
    minAmount: { type: Number, default: 0 }, // paise
    maxDiscount: { type: Number, default: null }, // paise cap for percent
    applicableTo: { type: [String], default: ['RECHARGE'] },
    firstTimeOnly: { type: Boolean, default: false },
    usageLimit: { type: Number, default: null }, // global
    perUserLimit: { type: Number, default: 1 },
    startAt: { type: Date, default: Date.now },
    endAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    combinable: { type: Boolean, default: false }, // combine with other offers?
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    createdAt: { type: Date, default: Date.now }
});

// Optional: maintain coupon counters elsewhere to avoid hot document updates
export default mongoose.model('Coupon', CouponSchema);
