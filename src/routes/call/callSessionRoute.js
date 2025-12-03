import express from "express";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import {
  getAstrologerCallSessions,
  requestCallSession,
  startCallSession,
} from "../../controllers/call/callSessionController.js";

const router = express.Router();

router.post("/request", authMiddleware, requestCallSession);
router.post("/session/:sessionId/start", authMiddleware, startCallSession);

router.get("/session", authMiddleware, getAstrologerCallSessions);

export default router;
