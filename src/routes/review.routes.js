import express from "express";
import { ReviewController, getCompletedRequestCountController } from "../controllers/review.controller.js";
import { authMiddleware } from "../middleware/authmiddleware.js";
const router = express.Router();

/**
 * ⭐ Add a review (Protected)
 * Body:
 *  - astrologerId
 *  - sessionId
 *  - sessionType ("CALL" | "CHAT")
 *  - stars
 *  - review (optional)
 */
router.post("/add", authMiddleware, ReviewController.addReview);

/**
 * ⭐ Get average rating + total reviews (Public)
 * /api/review/<astrologerId>/stats
 */
router.get("/:astrologerId/stats", ReviewController.getRatingStats);

/**
 * ⭐ Get all reviews of astrologer (Public)
 * /api/review/<astrologerId>/list
 */
router.get("/:astrologerId/list", ReviewController.getReviews);
router.get(
    "/astro/:astrologerId/completed-count",
    getCompletedRequestCountController
);

export default router;
