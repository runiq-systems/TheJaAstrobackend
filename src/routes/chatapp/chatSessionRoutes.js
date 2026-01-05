import express from "express";


import {
    requestChatSession,
    acceptChatRequest,
    rejectChatRequest,
    cancelChatRequest,
    startChatSession,
    endChatSession,
    getSessionDetails,
    pauseChatSession,
    resumeChatSession,
    getAstrologerSessions,
    getSessionStats,
    checkIfSessionIsCompleted
} from "../../controllers/chatapp/chatSessionController.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
const router = express.Router();

// User routes
router.post("/request", authMiddleware, requestChatSession);
router.post("/request/:requestId/cancel", authMiddleware, cancelChatRequest);
router.post("/session/:sessionId/start", authMiddleware, startChatSession);
router.post("/session/:sessionId/end", authMiddleware, endChatSession);
router.get("/session/:sessionId", authMiddleware, getSessionDetails);

// Astrologer routes  
router.post("/request/:requestId/accept", authMiddleware, acceptChatRequest);
router.post("/session/:sessionId/resume", authMiddleware, resumeChatSession);
router.post("/request/:requestId/reject", authMiddleware, rejectChatRequest);



// Get all chat sessions for astrologer with filtering and pagination
router.get("/sessions", authMiddleware, getAstrologerSessions);
router.get("/sessions/stats/overview", authMiddleware, getSessionStats);
router.get("/sessions/check-status", authMiddleware, checkIfSessionIsCompleted)

export default router;