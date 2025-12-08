import express from "express";
import { getTopAstrologers } from "../../controllers/getAstrologer/Topastrologer.js";
import { toggleOnlineStatus } from "../../controllers/getAstrologer/Topastrologer.js";
const router = express.Router();

router.get("/getTopAstrologers", getTopAstrologers);
router.get("/toggleOnlineStatus", toggleOnlineStatus);



export default router;
