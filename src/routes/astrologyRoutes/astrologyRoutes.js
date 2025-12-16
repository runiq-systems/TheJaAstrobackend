import express from "express";
import { getAdvancedKundaliReport, getBirthDetails, getDailyHoroscope,getKundaliCompatibility,getKundaliReport } from "../../controllers/Astrologycontroller/astrologyController.js";
import { astrologyRateLimiter } from "../../middleware/ratelimiter.js";

const router = express.Router();

router.use(astrologyRateLimiter)
router.get("/daily-horoscope", getDailyHoroscope);
router.post("/birth-details", getBirthDetails);
router.post("/kundali-matching", getKundaliCompatibility);
router.post("/kundali-report", getKundaliReport);

router.post("/kundali-advanced", getAdvancedKundaliReport);  // NEW

export default router;
