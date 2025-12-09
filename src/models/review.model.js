import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        astrologerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

        sessionId: { type: String, required: true, index: true },  // CALL_xxx or CHAT_xxx
        sessionType: { type: String, enum: ["CALL", "CHAT"], required: true },

        stars: { type: Number, min: 1, max: 5, required: true },
        review: { type: String, maxlength: 500 },

    },
    { timestamps: true }
);

reviewSchema.index({ astrologerId: 1, stars: -1 });

export const Review = mongoose.model("Review", reviewSchema);
