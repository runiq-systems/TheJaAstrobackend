import { reviewService } from "../services/review.service.js";
import { ChatRequest } from "../models/chatapp/chatRequest.js";
import { CallRequest } from "../models/calllogs/callRequest.js";

export const ReviewController = {
    // ⭐ Create review
    async addReview(req, res) {
        try {
            const { astrologerId, sessionId, sessionType, stars, review } = req.body;
            const userId = req.user._id; // from auth middleware

            const newReview = await reviewService.addReview({
                userId,
                astrologerId,
                sessionId,
                sessionType,
                stars,
                review,
            });

            return res.status(201).json({
                ok: true,
                message: "Review submitted successfully",
                data: newReview,
            });
        } catch (error) {
            return res.status(400).json({ ok: false, message: error.message });
        }
    },

    // ⭐ Get average + total review count
    async getRatingStats(req, res) {
        try {
            const { astrologerId } = req.params;

            const stats = await reviewService.getAverageRating(astrologerId);

            return res.status(200).json({
                ok: true,
                message: "Rating fetched",
                data: stats,
            });
        } catch (error) {
            return res.status(500).json({ ok: false, message: error.message });
        }
    },

    // ⭐ Get review list
    async getReviews(req, res) {
        try {
            const { astrologerId } = req.params;

            const reviews = await reviewService.getReviews(astrologerId);

            return res.status(200).json({
                ok: true,
                message: "Reviews fetched",
                data: reviews,
            });
        } catch (error) {
            return res.status(500).json({ ok: false, message: error.message });
        }
    },
};





/**
 * GET TOTAL COMPLETED CHAT + CALL REQUEST COUNT
 * @route GET /api/v1/astro/completed-request-count
 * @access Private (Astrologer)
 */
export const getCompletedRequestCountController = async (req, res) => {
    try {
        const { astrologerId } = req.params;


        const [completedChats, completedCalls] = await Promise.all([
            // ✅ Completed Chats
            ChatRequest.countDocuments({
                astrologerId,
                status: "COMPLETED",
            }),

            // ✅ Completed Calls
            CallRequest.countDocuments({
                astrologerId,
                status: "COMPLETED",
            }),
        ]);

        return res.status(200).json({
            ok: true,
            message: "Completed chat and call counts fetched successfully",
            data: {
                completedChats,
                completedCalls,
                totalCompleted: completedChats + completedCalls,
            },
        });
    } catch (error) {
        console.error("Completed request count error:", error);
        return res.status(500).json({
            ok: false,
            message: "Failed to fetch completed request counts",
        });
    }
};
