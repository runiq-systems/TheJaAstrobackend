// models/Reservation.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const ReservationSchema = new Schema({
    reservationId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true }, // paise
    status: { type: String, enum: ['ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED'], default: 'ACTIVE' },
    reason: { type: String }, // e.g., 'CALL_RESERVE'
    meta: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null } // TTL/expiry to auto-release
});

ReservationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Reservation', ReservationSchema);
