import express from "express";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import {
  acceptCallSession,
  cancelCallRequest,
  getAstrologerCallSessions,
  rejectCall,
  requestCallSession,
  startCallSession,
} from "../../controllers/call/callSessionController.js";
import { endChatSession } from "../../controllers/chatapp/chatSessionController.js";

const router = express.Router();

router.post("/request", authMiddleware, requestCallSession);
router.post("/session/:sessionId/start", authMiddleware, startCallSession);
router.post("/request/:requestId/cancel", authMiddleware, cancelCallRequest);
router.post("/session/:sessionId/end", authMiddleware, endChatSession);
router.post("/request/:requestId/reject", authMiddleware, rejectCall);

router.post("/request/:requestId/accept", authMiddleware, acceptCallSession);

router.get("/session", authMiddleware, getAstrologerCallSessions);

export default router;
