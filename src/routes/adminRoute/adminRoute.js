import express from "express";
import {
    getAstrologerVerificationDetails,
    updateAstrologerKYC,
    updateAstrologerBankDetails,
    approveOrRejectAstrologer
} from "../../controllers/admin/getAstrologerVerificationDetails.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import { requireAdmin } from "../../middleware/authmiddleware.js";

const router = express.Router();

router.get(
    "/astrologers/:astrologerId/verification",
    authMiddleware,
    requireAdmin,
    getAstrologerVerificationDetails
);

router.patch(
    "/astrologers/:astrologerId/kyc",
    authMiddleware,
    requireAdmin,
    updateAstrologerKYC
);

router.patch(
    "/astrologers/:astrologerId/bank",
    authMiddleware,
    requireAdmin,
    updateAstrologerBankDetails
);

router.patch(
    "/astrologers/:astrologerId/approval",
    authMiddleware,
    requireAdmin,
    approveOrRejectAstrologer
);

export default router;
