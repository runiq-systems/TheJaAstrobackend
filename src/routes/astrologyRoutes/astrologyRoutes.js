import express from "express";
import { astrologyRateLimiter } from "../../middleware/ratelimiter.js";
import { getAdvancedKundaliReport, getDailyHoroscope, getKundliMatch } from "../../controllers/Astrologycontroller/astrologyController.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
const router = express.Router();

// router.use(astrologyRateLimiter)
// router.post("/birth-details", getBirthDetails);
router.post("/kundali-matching", authMiddleware, getKundliMatch);
router.post("/kundali-report-advanced", authMiddleware, getAdvancedKundaliReport);  // NEW
router.get("/daily-horoscope", authMiddleware, getDailyHoroscope)
export default router;
