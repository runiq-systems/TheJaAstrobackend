import { ChatSession } from "../../models/chatapp/chatSession.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { Chat } from "../../models/chatapp/chat.js";
import { User } from "../../models/user.js";
import { Astrologer } from "../../models/astrologer.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

import { emitSocketEvent } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import mongoose from "mongoose";





/**
 * @desc    User requests to chat with astrologer
 * @route   POST /api/v1/chat/request
 * @access  Private (User)
 */
export const requestChatSession = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const { astrologerId, userMessage } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!astrologerId) {
            throw new ApiError(400, "Astrologer ID is required");
        }

        // Check if astrologer exists and is available
        const astrologer = await User.findOne({
            _id: astrologerId,
            role: "astrologer",
            userStatus: "Active",
            isSuspend: false
        }).session(session);

        if (!astrologer) {
            throw new ApiError(404, "Astrologer not found or not available");
        }

        // Check if user has existing pending/active session with this astrologer
        const existingSession = await ChatSession.findOne({
            userId,
            astrologerId,
            status: { $in: ["REQUESTED", "WAITING", "ACCEPTED", "ACTIVE", "PAUSED"] }
        }).session(session);

        if (existingSession) {
            throw new ApiError(400, "You already have an active session with this astrologer");
        }

        // Check if there's a pending request
        const existingRequest = await ChatRequest.findOne({
            userId,
            astrologerId,
            status: "PENDING"
        }).session(session);

        if (existingRequest) {
            throw new ApiError(400, "You already have a pending request with this astrologer");
        }

        // Create chat room first
        const chat = await Chat.findOrCreatePersonalChat(userId, astrologerId);

        // Create chat request
        const request = await ChatRequest.create([{
            requestId: ChatRequest.generateRequestId(),
            userId,
            astrologerId,
            userMessage: userMessage?.trim(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
            meta: {
                chatId: chat._id
            }
        }], { session });

        // Create chat session
        const chatSession = await ChatSession.create([{
            sessionId: ChatSession.generateSessionId(),
            userId,
            astrologerId,
            chatId: chat._id,
            status: "REQUESTED",
            requestedAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
            ratePerMinute: 10, // Default rate, can be customized per astrologer
            meta: {
                requestId: request[0]._id,
                chatId: chat._id
            }
        }], { session });

        // Update request with session ID
        await ChatRequest.findByIdAndUpdate(
            request[0]._id,
            { sessionId: chatSession[0]._id },
            { session }
        );

        await session.commitTransaction();

        // Populate data for response
        await chatSession[0].populate([
            { path: "userId", select: "fullName phone avatar" },
            { path: "astrologerId", select: "fullName phone avatar" }
        ]);

        // Notify astrologer via socket
        emitSocketEvent(req, astrologerId.toString(), ChatEventsEnum.CHAT_REQUEST_EVENT, {
            requestId: request[0].requestId,
            sessionId: chatSession[0].sessionId,
            userId: userId,
            userInfo: {
                fullName: req.user.fullName,
                phone: req.user.phone
            },
            userMessage,
            expiresAt: request[0].expiresAt
        });

        // Send push notification to astrologer
        await sendNotification({
            userId: astrologerId,
            title: "New Chat Request",
            message: `${req.user.fullName} wants to chat with you`,
            type: "chat_request",
            data: {
                requestId: request[0].requestId,
                sessionId: chatSession[0].sessionId,
                userId: userId
            }
        });

        return res.status(201).json(
            new ApiResponse(201, {
                requestId: request[0].requestId,
                sessionId: chatSession[0].sessionId,
                status: "REQUESTED",
                expiresAt: request[0].expiresAt,
                astrologerInfo: {
                    fullName: astrologer.fullName,
                    phone: astrologer.phone
                }
            }, "Chat request sent successfully")
        );

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
});

/**
 * @desc    Astrologer accepts chat request
 * @route   POST /api/v1/chat/request/:requestId/accept
 * @access  Private (Astrologer)
 */
export const acceptChatRequest = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const { requestId } = req.params;
        const astrologerId = req.user.id; // Changed from req.astrologer._id to req.user.id

        // Verify user is an astrologer
        if (req.user.role !== "astrologer") {
            throw new ApiError(403, "Only astrologers can accept chat requests");
        }

        // Find and validate request
        const chatRequest = await ChatRequest.findOne({
            requestId,
            astrologerId,
            status: "PENDING"
        }).session(session);

        if (!chatRequest) {
            throw new ApiError(404, "Chat request not found or already processed");
        }

        if (chatRequest.isExpired()) {
            await ChatRequest.findByIdAndUpdate(
                chatRequest._id,
                { status: "EXPIRED" },
                { session }
            );
            throw new ApiError(400, "Chat request has expired");
        }

        // Find associated session
        const chatSession = await ChatSession.findById(chatRequest.sessionId).session(session);
        if (!chatSession) {
            throw new ApiError(404, "Chat session not found");
        }

        // Update request and session
        const now = new Date();

        await ChatRequest.findByIdAndUpdate(
            chatRequest._id,
            {
                status: "ACCEPTED",
                respondedAt: now
            },
            { session }
        );

        await ChatSession.findByIdAndUpdate(
            chatSession._id,
            {
                status: "ACCEPTED",
                acceptedAt: now
            },
            { session }
        );

        await session.commitTransaction();

        // Notify user via socket
        emitSocketEvent(req, chatRequest.userId.toString(), ChatEventsEnum.CHAT_ACCEPTED_EVENT, {
            requestId: chatRequest.requestId,
            sessionId: chatSession.sessionId,
            astrologerId: astrologerId,
            astrologerInfo: {
                fullName: req.user.fullName,
                phone: req.user.phone
            }
        });

        // Send push notification to user
        await sendNotification({
            userId: chatRequest.userId,
            title: "Chat Request Accepted",
            message: `${req.user.fullName} has accepted your chat request`,
            type: "chat_accepted",
            data: {
                requestId: chatRequest.requestId,
                sessionId: chatSession.sessionId,
                astrologerId: astrologerId
            }
        });

        return res.status(200).json(
            new ApiResponse(200, {
                requestId: chatRequest.requestId,
                sessionId: chatSession.sessionId,
                status: "ACCEPTED"
            }, "Chat request accepted successfully")
        );

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
});

/**
 * @desc    Astrologer rejects chat request
 * @route   POST /api/v1/chat/request/:requestId/reject
 * @access  Private (Astrologer)
 */
export const rejectChatRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const astrologerId = req.user.id; // Changed from req.astrologer._id to req.user.id

    // Verify user is an astrologer
    if (req.user.role !== "astrologer") {
        throw new ApiError(403, "Only astrologers can reject chat requests");
    }

    const chatRequest = await ChatRequest.findOne({
        requestId,
        astrologerId,
        status: "PENDING"
    });

    if (!chatRequest) {
        throw new ApiError(404, "Chat request not found or already processed");
    }

    if (chatRequest.isExpired()) {
        await ChatRequest.findByIdAndUpdate(chatRequest._id, { status: "EXPIRED" });
        throw new ApiError(400, "Chat request has expired");
    }

    // Update request and session
    await ChatRequest.findByIdAndUpdate(chatRequest._id, {
        status: "REJECTED",
        respondedAt: new Date()
    });

    await ChatSession.findByIdAndUpdate(chatRequest.sessionId, {
        status: "REJECTED"
    });

    // Notify user
    emitSocketEvent(req, chatRequest.userId.toString(), ChatEventsEnum.CHAT_REJECTED_EVENT, {
        requestId: chatRequest.requestId,
        astrologerId: astrologerId
    });

    return res.status(200).json(
        new ApiResponse(200, {
            requestId: chatRequest.requestId,
            status: "REJECTED"
        }, "Chat request rejected successfully")
    );
});

/**
 * @desc    User cancels chat request
 * @route   POST /api/v1/chat/request/:requestId/cancel
 * @access  Private (User)
 */
export const cancelChatRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const userId = req.user.id;

    const chatRequest = await ChatRequest.findOne({
        requestId,
        userId,
        status: "PENDING"
    });

    if (!chatRequest) {
        throw new ApiError(404, "Chat request not found or already processed");
    }

    // Update request and session
    await ChatRequest.findByIdAndUpdate(chatRequest._id, {
        status: "CANCELLED"
    });

    await ChatSession.findByIdAndUpdate(chatRequest.sessionId, {
        status: "CANCELLED"
    });

    // Notify astrologer
    emitSocketEvent(req, chatRequest.astrologerId.toString(), ChatEventsEnum.CHAT_CANCELLED_EVENT, {
        requestId: chatRequest.requestId,
        userId: userId
    });

    return res.status(200).json(
        new ApiResponse(200, {
            requestId: chatRequest.requestId,
            status: "CANCELLED"
        }, "Chat request cancelled successfully")
    );
});

/**
 * @desc    Start chat session (when both enter chat room)
 * @route   POST /api/v1/chat/session/:sessionId/start
 * @access  Private
 */
export const startChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const chatSession = await ChatSession.findOne({
        sessionId,
        $or: [{ userId }, { astrologerId: userId }],
        status: "ACCEPTED"
    });

    if (!chatSession) {
        throw new ApiError(404, "Chat session not found or not ready to start");
    }

    // Start session
    await ChatSession.findByIdAndUpdate(chatSession._id, {
        status: "ACTIVE",
        startedAt: new Date(),
        lastActivityAt: new Date()
    });

    // Start billing timer
    await startBillingTimer(chatSession.sessionId, chatSession.chatId, chatSession.ratePerMinute);

    // Notify both parties
    emitSocketEvent(req, chatSession.chatId.toString(), ChatEventsEnum.SESSION_STARTED_EVENT, {
        sessionId: chatSession.sessionId,
        startedAt: new Date()
    });

    return res.status(200).json(
        new ApiResponse(200, {
            sessionId: chatSession.sessionId,
            status: "ACTIVE",
            startedAt: new Date()
        }, "Chat session started successfully")
    );
});

/**
 * @desc    End chat session
 * @route   POST /api/v1/chat/session/:sessionId/end
 * @access  Private
 */
export const endChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const chatSession = await ChatSession.findOne({
        sessionId,
        $or: [{ userId }, { astrologerId: userId }],
        status: { $in: ["ACTIVE", "PAUSED"] }
    });

    if (!chatSession) {
        throw new ApiError(404, "Active chat session not found");
    }

    // Stop billing timer
    stopBillingTimer(sessionId);

    // Complete session (this handles billing calculation)
    await chatSession.completeSession();

    // Process payment
    await processSessionPayment(chatSession);

    // Notify both parties
    emitSocketEvent(req, chatSession.chatId.toString(), ChatEventsEnum.SESSION_ENDED_EVENT, {
        sessionId: chatSession.sessionId,
        endedAt: chatSession.endedAt,
        totalCost: chatSession.totalCost,
        totalDuration: chatSession.totalDuration,
        billedDuration: chatSession.billedDuration
    });

    return res.status(200).json(
        new ApiResponse(200, {
            sessionId: chatSession.sessionId,
            status: "COMPLETED",
            totalCost: chatSession.totalCost,
            totalDuration: chatSession.totalDuration,
            billedDuration: chatSession.billedDuration
        }, "Chat session ended successfully")
    );
});

/**
 * @desc    Get session details
 * @route   GET /api/v1/chat/session/:sessionId
 * @access  Private
 */
export const getSessionDetails = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const chatSession = await ChatSession.findOne({
        sessionId,
        $or: [{ userId }, { astrologerId: userId }]
    }).populate([
        { path: "userId", select: "fullName phone avatar" },
        { path: "astrologerId", select: "fullName phone avatar" }
    ]);

    if (!chatSession) {
        throw new ApiError(404, "Chat session not found");
    }

    return res.status(200).json(
        new ApiResponse(200, chatSession, "Session details retrieved successfully")
    );
});

/**
 * @desc    Pause chat session (when astrologer leaves)
 * @route   POST /api/v1/chat/session/:sessionId/pause
 * @access  Private (Astrologer)
 */
export const pauseChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const astrologerId = req.user.id;

    // Verify user is an astrologer
    if (req.user.role !== "astrologer") {
        throw new ApiError(403, "Only astrologers can pause sessions");
    }

    const chatSession = await ChatSession.findOne({
        sessionId,
        astrologerId,
        status: "ACTIVE"
    });

    if (!chatSession) {
        throw new ApiError(404, "Active chat session not found");
    }

    // Pause session
    await chatSession.pauseSession();

    // Stop billing timer
    stopBillingTimer(sessionId);

    // Notify both parties
    emitSocketEvent(req, chatSession.chatId.toString(), ChatEventsEnum.SESSION_PAUSED_EVENT, {
        sessionId: chatSession.sessionId,
        pausedAt: new Date()
    });

    return res.status(200).json(
        new ApiResponse(200, {
            sessionId: chatSession.sessionId,
            status: "PAUSED"
        }, "Chat session paused successfully")
    );
});

/**
 * @desc    Resume chat session (when astrologer returns)
 * @route   POST /api/v1/chat/session/:sessionId/resume
 * @access  Private (Astrologer)
 */
export const resumeChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const astrologerId = req.user.id;

    // Verify user is an astrologer
    if (req.user.role !== "astrologer") {
        throw new ApiError(403, "Only astrologers can resume sessions");
    }

    const chatSession = await ChatSession.findOne({
        sessionId,
        astrologerId,
        status: "PAUSED"
    });

    if (!chatSession) {
        throw new ApiError(404, "Paused chat session not found");
    }

    // Resume session
    await chatSession.resumeSession();

    // Start billing timer again
    await startBillingTimer(chatSession.sessionId, chatSession.chatId, chatSession.ratePerMinute);

    // Notify both parties
    emitSocketEvent(req, chatSession.chatId.toString(), ChatEventsEnum.SESSION_RESUMED_EVENT, {
        sessionId: chatSession.sessionId,
        resumedAt: new Date()
    });

    return res.status(200).json(
        new ApiResponse(200, {
            sessionId: chatSession.sessionId,
            status: "ACTIVE"
        }, "Chat session resumed successfully")
    );
});

// Utility functions
const billingTimers = new Map();

const startBillingTimer = async (sessionId, chatId, ratePerMinute) => {
    if (billingTimers.has(sessionId)) {
        console.log(`Billing already active for session: ${sessionId}`);
        return;
    }

    console.log(`Starting billing for session: ${sessionId}`);

    const interval = setInterval(async () => {
        try {
            const session = await ChatSession.findOne({ sessionId, status: "ACTIVE" });

            if (!session) {
                stopBillingTimer(sessionId);
                return;
            }

            // Update billed duration
            await ChatSession.findByIdAndUpdate(session._id, {
                $inc: { billedDuration: 60 }, // Add 60 seconds
                lastActivityAt: new Date()
            });

            // Calculate current cost
            const updatedSession = await ChatSession.findOne({ sessionId });
            const currentCost = updatedSession.calculateCurrentCost();

            // Notify clients about billing update
            emitSocketEvent({ app: { get: () => global.io } }, chatId, ChatEventsEnum.BILLING_UPDATE_EVENT, {
                sessionId,
                billedDuration: updatedSession.billedDuration,
                currentCost,
                ratePerMinute
            });

            console.log(`Billed session ${sessionId}: ${updatedSession.billedDuration}s, ₹${currentCost}`);

        } catch (error) {
            console.error(`Billing error for session ${sessionId}:`, error);
            stopBillingTimer(sessionId);
        }
    }, 60000); // Every minute

    billingTimers.set(sessionId, interval);
};

const stopBillingTimer = (sessionId) => {
    const interval = billingTimers.get(sessionId);
    if (interval) {
        clearInterval(interval);
        billingTimers.delete(sessionId);
        console.log(`Stopped billing for session: ${sessionId}`);
    }
};

const processSessionPayment = async (chatSession) => {
    console.log(`Processing payment for session ${chatSession.sessionId}:`);
    console.log(`- Total Cost: ${chatSession.totalCost}`);
    console.log(`- Platform Commission: ${chatSession.platformCommission}`);
    console.log(`- Astrologer Earnings: ${chatSession.astrologerEarnings}`);

    // TODO: Integrate with your wallet system
    // await Wallet.deductFromUser(chatSession.userId, chatSession.totalCost);
    // await Wallet.creditToAstrologer(chatSession.astrologerId, chatSession.astrologerEarnings);
};

const sendNotification = async ({ userId, title, message, type, data }) => {
    try {
        console.log(`Notification to ${userId}: ${title} - ${message}`);
        // Implement your notification logic here
    } catch (error) {
        console.error("Failed to send notification:", error);
    }
};