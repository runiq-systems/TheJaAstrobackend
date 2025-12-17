import express from "express";
import { getTopAstrologers, getAstrologerProfile, updateAstrologerProfile } from "../../controllers/getAstrologer/Topastrologer.js";
import { toggleOnlineStatus } from "../../controllers/getAstrologer/Topastrologer.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import { uploadSingleImage } from "../../middleware/Uploadimage.js";
const router = express.Router();

router.get("/getTopAstrologers", getTopAstrologers);
router.get("/toggleOnlineStatus", toggleOnlineStatus);

router.get(
    "/profile",
    authMiddleware,
    getAstrologerProfile
);

router.put(
    "/profile",
    authMiddleware,
    uploadSingleImage,
    updateAstrologerProfile
);

export default router;
