import express from "express";
import { authMiddleware } from "../middleware/authmiddleware.js";
import multer from "multer";
import {
    updateAstrologerStep1,
    updateAstrologerStep2,
    updateAstrologerStep3,
    getAstrologerProfile,
    getStep1Data,
    getStep2Data,
    getStep3Data,
    getAstrologersOnlineStatus
} from "../controllers/AstrologerProfile.js";
const router = express.Router();

// Multer memory storage for Cloudinary
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ============================================================
   ASTROLOGER PROFILE COMPLETION ROUTES (3 Steps)
============================================================ */

// ---------------------------
// STEP 1 — Basic Information
// ---------------------------
router.put(
    "/step1",
    authMiddleware,
    updateAstrologerStep1
);

// ---------------------------
// STEP 2 — Experience + Lang + Profile Photo
// ---------------------------
router.put(
    "/step2",
    authMiddleware,
    upload.single("photo"),  // profile image
    updateAstrologerStep2
);

// ---------------------------
// STEP 3 — Full KYC + Bank Details
// ---------------------------
router.put(
    "/step3",
    authMiddleware,
    upload.fields([
        { name: "panCardImage", maxCount: 1 },
        { name: "aadhaarFrontImage", maxCount: 1 },
        { name: "aadhaarBackImage", maxCount: 1 },
        { name: "passbookImage", maxCount: 1 },
        { name: "qualificationImage", maxCount: 1 },
    ]),
    updateAstrologerStep3
);


router.get('/astro/profile', authMiddleware, getAstrologerProfile);
router.get('/astro/step1', authMiddleware, getStep1Data);
router.get('/astro/step2', authMiddleware, getStep2Data);
router.get('/astro/step3', authMiddleware, getStep3Data);

router.get('/chat-session/request', authMiddleware, getAstrologersOnlineStatus)

export default router;
