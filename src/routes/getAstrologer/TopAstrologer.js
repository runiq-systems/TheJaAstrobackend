import express from "express";
import { getTopAstrologers } from "../../controllers/getAstrologer/Topastrologer.js";
import { getDailyHoroscope ,getKundaliMatch,getKundaliReport} from "../../controllers/horoscope/horoscopeController.js";
const router = express.Router();

router.get("/getTopAstrologers", getTopAstrologers);
router.get('/getDailyHoroscope',getDailyHoroscope);
router.get('/getKundaliMatch',getKundaliMatch);
router.get('/getKundaliReport',getKundaliReport);


export default router;
