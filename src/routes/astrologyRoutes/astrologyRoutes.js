import express from "express";
import { getDailyHoroscope,getKundaliMatching,getKundaliReport } from "../../controllers/Astrologycontroller/astrologyController";

const router = express.Router();

router.get("/daily-horoscope", getDailyHoroscope);
router.post("/kundali-matching", getKundaliMatching);
router.post("/kundali-report", getKundaliReport);

export default router;
