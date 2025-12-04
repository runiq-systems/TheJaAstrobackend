import express from "express";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import {
  acceptCallSession,
  cancelCallRequest,
  getAstrologerCallSessions,
  requestCallSession,
  resumeCallSession,
  startCallSession,
} from "../../controllers/call/callSessionController.js";
import { endChatSession } from "../../controllers/chatapp/chatSessionController.js";

const router = express.Router();

router.post("/request", authMiddleware, requestCallSession);
router.post("/session/:sessionId/start", authMiddleware, startCallSession);
router.post("/request/:requestId/cancel", authMiddleware, cancelCallRequest);
router.post("/session/:sessionId/end", authMiddleware, endChatSession);

router.post("/request/:requestId/accept", authMiddleware, acceptCallSession);
router.post("/session/:sessionId/resume", authMiddleware, resumeCallSession);

router.get("/session", authMiddleware, getAstrologerCallSessions);

export default router;
