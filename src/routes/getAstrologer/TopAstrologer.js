import express from "express";
import { getTopAstrologers, getMe, getAstrologerProfile, updateAstrologerProfile } from "../../controllers/getAstrologer/Topastrologer.js";
import { toggleOnlineStatus } from "../../controllers/getAstrologer/Topastrologer.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import { uploadSingleImage } from "../../middleware/Uploadimage.js";
const router = express.Router();

router.get("/getTopAstrologers", getTopAstrologers);
router.post("/toggleOnlineStatus", authMiddleware, toggleOnlineStatus);
router.post("/me", authMiddleware, getMe);

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
