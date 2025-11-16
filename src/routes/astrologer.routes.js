import express from "express";
import { authMiddleware } from "../middleware/authmiddleware.js";
import multer from "multer";
import {
    updateAstrologerStep1,
    updateAstrologerStep2,
    updateAstrologerStep3
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

export default router;
