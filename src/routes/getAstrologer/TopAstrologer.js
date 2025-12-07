import express from "express";
import { getTopAstrologers } from "../../controllers/getAstrologer/Topastrologer.js";
import { getDailyHoroscope } from "../../controllers/horoscope/horoscopeController.js";
const router = express.Router();

router.get("/getTopAstrologers", getTopAstrologers);
router.get('/getDailyHoroscope',getDailyHoroscope);


export default router;
