import { Review } from "../models/review.model.js";
import mongoose from 'mongoose';

class ReviewService {
    // ⭐ Create review
    async addReview({ userId, astrologerId, sessionId, sessionType, stars, review }) {
        const exists = await Review.findOne({ userId, sessionId });

        if (exists) {
            throw new Error("You already reviewed this session.");
        }

        return Review.create({
            userId,
            astrologerId,
            sessionId,
            sessionType,
            stars,
            review,
        });
    }

    // In your ReviewService
    async getAverageRating(astrologerId) {
        // ← Convert string → ObjectId
        const objectId = new mongoose.Types.ObjectId(astrologerId);

        const result = await Review.aggregate([
            { $match: { astrologerId: objectId } }, // ← Use ObjectId
            {
                $group: {
                    _id: "$astrologerId",
                    averageRating: { $avg: "$stars" },
                    totalReviews: { $sum: 1 },
                },
            },
        ]);

        if (!result.length) {
            return { averageRating: 0, totalReviews: 0 };
        }

        return {
            averageRating: Number(result[0].averageRating.toFixed(1)),
            totalReviews: result[0].totalReviews,
        };
    }

    // ⭐ Get all reviews for profile page
    async getReviews(astrologerId, limit = 30) {
        const objectId = new mongoose.Types.ObjectId(astrologerId);
        return Review.find({ astrologerId: objectId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("userId", "fullName photo");
    }
}

export const reviewService = new ReviewService();
