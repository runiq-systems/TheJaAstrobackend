import express from "express";
import { astrologyRateLimiter } from "../../middleware/ratelimiter.js";
import {
    getAdvancedKundaliReport,
    getDailyHoroscope,
    getKundliMatch,
    getMatchHistory,
    getKundaliReportDetailController,
    getUserKundaliReports,
    getMatchDetails
} from "../../controllers/Astrologycontroller/astrologyController.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
const router = express.Router();


// router.use(astrologyRateLimiter)
// router.post("/birth-details", getBirthDetails);
router.post("/kundali-matching", authMiddleware, getKundliMatch);
router.post("/kundali-report-advanced", authMiddleware, getAdvancedKundaliReport);  // NEW
router.get("/daily-horoscope", authMiddleware, getDailyHoroscope)





router.get("/matches", authMiddleware, getMatchHistory);

// Particular match detail
router.get("/matches/:matchId", authMiddleware, getMatchDetails);




router.get(
    "/reports",
    authMiddleware,
    getUserKundaliReports
);

/**
 * @route   GET /api/kundali/reports/:id
 * @desc    Get particular kundali report detail
 * @params  id = reportId
 * @access  Private
 */
router.get(
    "/reports/:id",
    authMiddleware,
    getKundaliReportDetailController
);

export default router;
