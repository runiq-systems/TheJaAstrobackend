import { Review } from "../models/review.model.js";

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

    // ⭐ Get average rating
    async getAverageRating(astrologerId) {
        const result = await Review.aggregate([
            { $match: { astrologerId } },
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
        return Review.find({ astrologerId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("userId", "name avatar");
    }
}

export const reviewService = new ReviewService();
