import express from "express";
import { getAdvancedKundaliReport, getBirthDetails, getDailyHoroscope,getKundaliCompatibilityTest,getKundaliReport } from "../../controllers/Astrologycontroller/astrologyController.js";

const router = express.Router();

router.get("/daily-horoscope", getDailyHoroscope);
router.post("/birth-details", getBirthDetails);
router.post("/kundali-matching", getKundaliCompatibilityTest);
router.post("/kundali-report", getKundaliReport);

router.post("/kundali-advanced", getAdvancedKundaliReport);  // NEW

export default router;
