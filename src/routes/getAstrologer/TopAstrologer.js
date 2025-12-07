import express from "express";
import { getTopAstrologers } from "../../controllers/getAstrologer/Topastrologer.js";
const router = express.Router();

router.get("/getTopAstrologers", getTopAstrologers);



export default router;
