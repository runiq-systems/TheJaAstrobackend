import {
    getAstrologerById, updateAstrologerById

} from "../../controllers/admin/astrologer.controller.js";
import { adminMiddleware } from "../../middleware/authmiddleware.js";
import express from "express";
const router = express.Router();
router.get(
    "/astrologers/:astrologerId",
    adminMiddleware,
    getAstrologerById
);
router.put(
    "/astrologers/:astrologerId",
    adminMiddleware,
    updateAstrologerById
);
export default router;