// controllers/chatapp/chatController.js
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { Chat } from "../../models/chatapp/chat.js";
import { User } from "../../models/user.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { WalletService } from "../Wallet/walletIntegrationController.js";
import { emitSocketEvent } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import mongoose from "mongoose";
import admin from "../../utils/firabse.js";

// Global billing timers map
const billingTimers = new Map();

/**
 * @desc    Enhanced chat request with better validation and flow
 */
export const requestChatSession = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const { astrologerId, userMessage, chatType = "TEXT" } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!astrologerId) {
            throw new ApiError(400, "Astrologer ID is required");
        }

        // Check if user is trying to chat with themselves
        if (astrologerId.toString() === userId.toString()) {
            throw new ApiError(400, "Cannot start chat with yourself");
        }

        // Check astrologer availability and validity
        const astrologer = await User.findOne({
            _id: astrologerId,
            role: "astrologer",
            userStatus: "Active",
            isSuspend: false
        }).session(session).select("fullName phone avatar chatRate isOnline");

        if (!astrologer) {
            throw new ApiError(404, "Astrologer not found or not available");
        }

        // Check if astrologer is online
        if (!astrologer.isOnline) {
            throw new ApiError(400, "Astrologer is currently offline");
        }

        // Check for existing active sessions
        const existingSession = await ChatSession.findActiveSession(userId, astrologerId).session(session);
        if (existingSession) {
            throw new ApiError(400, `You already have a ${existingSession.status.toLowerCase()} session with this astrologer`);
        }

        // Check for pending requests
        const existingRequest = await ChatRequest.findOne({
            userId,
            astrologerId,
            status: "PENDING"
        }).session(session);

        if (existingRequest) {
            throw new ApiError(400, "You already have a pending request with this astrologer");
        }

        // Create or get chat room
        const chat = await Chat.findOrCreatePersonalChat(userId, astrologerId);

        // Generate request and session IDs
        const requestId = ChatRequest.generateRequestId();
        const sessionId = ChatSession.generateSessionId();

        // Use astrologer's custom rate or default
        const ratePerMinute = astrologer.chatRate || 10;

        // Create chat request
        const request = await ChatRequest.create([{
            requestId,
            userId,
            astrologerId,
            userMessage: userMessage?.trim(),
            chatType,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
            meta: {
                chatId: chat._id,
                ratePerMinute
            }
        }], { session });

        // Create chat session
        const chatSession = await ChatSession.create([{
            sessionId,
            userId,
            astrologerId,
            chatId: chat._id,
            ratePerMinute,
            status: "REQUESTED",
            requestedAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            meta: {
                request_Id: request[0]._id,
                requestId: request[0].requestId,

                chatId: chat._id,
                chatType
            }
        }], { session });

        // Update request with session ID
        await ChatRequest.findByIdAndUpdate(
            request[0]._id,
            { sessionId: chatSession[0]._id },
            { session }
        );

        await session.commitTransaction();

        // Populate session data
        await chatSession[0].populate([
            { path: "userId", select: "fullName phone avatar" },
            { path: "astrologerId", select: "fullName phone avatar chatRate" }
        ]);

        // Notify astrologer
        await notifyAstrologerAboutRequest(req, astrologerId, {
            requestId: request[0].requestId,
            sessionId: chatSession[0].sessionId,
            userId,
            userInfo: req.user,
            userMessage,
            ratePerMinute,
            expiresAt: request[0].expiresAt
        });

        return res.status(201).json(
            new ApiResponse(201, {
                requestId: request[0].requestId,
                sessionId: chatSession[0].sessionId,
                status: "REQUESTED",
                ratePerMinute,
                expiresAt: request[0].expiresAt,
                astrologerInfo: {
                    fullName: astrologer.fullName,
                    phone: astrologer.phone,
                    chatRate: astrologer.chatRate
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
 * @desc    Enhanced session start with wallet integration
 */
export const startChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id; // authenticated user (could be user or astrologer)

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Find the chat session that is accepted and belongs to user or astrologer
        const chatSession = await ChatSession.findOne({
            sessionId,
            $or: [{ userId }, { astrologerId: userId }],
            status: "ACCEPTED",
        }).session(session);

        if (!chatSession) {
            throw new ApiError(404, "Chat session not found or not ready to start");
        }

        // Only the user (customer) should start the session
        if (chatSession.userId.toString() !== userId) {
            throw new ApiError(403, "Only the user can start the chat session");
        }

        // Estimate initial cost: Reserve for 10 minutes (common practice)
        const estimatedMinutes = 10;
        const estimatedCost = chatSession.ratePerMinute * estimatedMinutes;

        if (estimatedCost <= 0) {
            throw new ApiError(400, "Invalid session rate");
        }

        // Check if user has sufficient balance
        const balanceCheck = await WalletService.checkBalance({
            userId: chatSession.userId,
            amount: estimatedCost,
            currency: "INR",
        });

        if (!balanceCheck.hasSufficientBalance) {
            throw new ApiError(
                402,
                "Insufficient balance to start chat session",
                {
                    shortfall: balanceCheck.shortfall,
                    available: balanceCheck.availableBalance,
                    required: estimatedCost,
                }
            );
        }

        // Reserve the amount from user's wallet (moves from available → locked)
        const reservationResult = await WalletService.reserveAmount({
            userId: chatSession.userId,
            amount: estimatedCost,
            currency: "INR",
            reservationId: chatSession._id, // Use session _id as reservation reference
            sessionType: "CHAT",
            description: `Initial reservation for chat session with astrologer (10 mins)`,
        });

        // Update chat session status to ACTIVE
        chatSession.status = "ACTIVE";
        chatSession.startedAt = new Date();
        chatSession.lastActivityAt = new Date();
        chatSession.paymentStatus = "RESERVED";
        chatSession.reservationId = chatSession._id; // optional: self-reference
        await chatSession.save({ session });

        // Commit transaction
        await session.commitTransaction();

        // Start background billing timer (deduct per minute)
        // Make sure this function is fire-and-forget or queued properly
        try {
            // const { startBillingTimer } = await import("../../utils/billingTimer.js");
            await startBillingTimer(
                chatSession.sessionId,
                chatSession.chatId,
                chatSession.ratePerMinute,
                chatSession._id // reservationId
            );
        } catch (err) {
            console.error("Failed to start billing timer:", err);
            // Non-critical: log but don't fail session start
        }

        // Notify both user and astrologer via socket
        emitSocketEvent(
            req,
            chatSession.chatId.toString(),
            ChatEventsEnum.SESSION_STARTED_EVENT,
            {
                sessionId: chatSession.sessionId,
                status: "ACTIVE",
                startedAt: new Date(),
                estimatedCost,
                ratePerMinute: chatSession.ratePerMinute,
                reservedAmount: estimatedCost,
                reservedMinutes: estimatedMinutes,
            }
        );

        // Success response
        return res.status(200).json(
            new ApiResponse(200, {
                sessionId: chatSession.sessionId,
                chatId: chatSession.chatId,
                status: "ACTIVE",
                startedAt: chatSession.startedAt,
                ratePerMinute: chatSession.ratePerMinute,
                estimatedCost,
                reservedForMinutes: estimatedMinutes,
                message: "Chat session started successfully",
            }, "Chat session started successfully")
        );
    } catch (error) {
        await session.abortTransaction();
        throw error; // Let asyncHandler handle it
    } finally {
        session.endSession();
    }
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
 * @desc    Enhanced session end with proper settlement
 */
export const endChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        console.log(`🔄 Ending chat session: ${sessionId} for user: ${userId}`);

        const chatSession = await ChatSession.findOne({
            sessionId,
            $or: [{ userId }, { astrologerId: userId }],
            status: { $in: ["ACTIVE", "PAUSED", "ACCEPTED"] }
        }).session(session);

        if (!chatSession) {
            throw new ApiError(404, "Active chat session not found");
        }

        // Stop billing timer
        stopBillingTimer(sessionId);

        const endedAt = new Date();
        const startedAt = chatSession.startedAt || chatSession.acceptedAt || endedAt;
        const totalDurationSec = Math.floor((endedAt - startedAt) / 1000);
        const billedMinutes = Math.max(1, Math.ceil(totalDurationSec / 60));
        const totalCost = chatSession.ratePerMinute * billedMinutes;

        console.log(`📊 Session metrics - Duration: ${totalDurationSec}s, Cost: ${totalCost}, Billed Minutes: ${billedMinutes}`);

        // Update ChatSession with calculated values
        chatSession.status = "COMPLETED";
        chatSession.endedAt = endedAt;
        chatSession.totalDuration = totalDurationSec;
        chatSession.billedDuration = billedMinutes * 60;
        chatSession.totalCost = totalCost;

        let paymentResult = null;
        let paymentStatus = "PENDING";
        let astrologerEarnings = 0;

        // Process payment if reservation exists
        if (chatSession.reservationId && mongoose.Types.ObjectId.isValid(chatSession.reservationId)) {
            try {
                console.log(`💳 Processing payment with reservation: ${chatSession.reservationId}`);

                paymentResult = await WalletService.processSessionPayment(chatSession.reservationId);
                paymentStatus = "PAID";
                astrologerEarnings = paymentResult.astrologerEarnings;

                console.log(`✅ Payment successful - Earnings: ${astrologerEarnings}`);

            } catch (paymentError) {
                console.error("❌ Payment processing failed:", paymentError);

                // Check if it's a balance issue or reservation issue
                if (paymentError.message.includes("Insufficient balance") ||
                    paymentError.message.includes("Reservation not found")) {
                    paymentStatus = "FAILED_INSUFFICIENT_BALANCE";
                } else if (paymentError.message.includes("Reservation is not in RESERVED state")) {
                    paymentStatus = "FAILED_INVALID_RESERVATION";
                } else {
                    paymentStatus = "FAILED";
                }

                // Store error details for debugging
                chatSession.paymentError = {
                    message: paymentError.message,
                    code: paymentError.statusCode || 500,
                    timestamp: new Date()
                };

                // Don't throw error - allow session to end but mark payment as failed
                console.warn(`⚠️ Payment failed but session will be ended. Status: ${paymentStatus}`);
            }
        } else {
            paymentStatus = "NO_RESERVATION";
            console.warn(`⚠️ No reservation ID found for session: ${sessionId}`);
        }

        // Update session with payment status
        chatSession.paymentStatus = paymentStatus;
        chatSession.astrologerEarnings = astrologerEarnings;

        await chatSession.save({ session });
        await session.commitTransaction();

        console.log(`✅ Session ended successfully - Payment Status: ${paymentStatus}`);

        // Notify both parties via socket
        try {
            emitSocketEvent(req, chatSession.chatId.toString(), ChatEventsEnum.SESSION_ENDED_EVENT, {
                sessionId: chatSession.sessionId,
                status: "COMPLETED",
                totalCost,
                totalDuration: totalDurationSec,
                billedMinutes,
                paymentStatus,
                astrologerEarnings,
                endedAt: chatSession.endedAt
            });
        } catch (socketErr) {
            console.warn("📢 Socket notification failed (non-critical):", socketErr.message);
        }

        // Prepare response message based on payment status
        let message = "Session ended successfully";
        if (paymentStatus === "PAID") {
            message = "Session ended and payment settled successfully";
        } else if (paymentStatus.startsWith("FAILED")) {
            message = "Session ended but payment failed - please contact support";
        } else if (paymentStatus === "NO_RESERVATION") {
            message = "Session ended - payment requires manual processing";
        }

        return res.status(200).json(new ApiResponse(200, {
            sessionId: chatSession.sessionId,
            status: "COMPLETED",
            totalCost,
            totalDuration: totalDurationSec,
            billedMinutes,
            paymentStatus,
            astrologerEarnings,
            endedAt: chatSession.endedAt,
            message
        }, message));

    } catch (error) {
        await session.abortTransaction();
        console.error("❌ Session end error:", {
            sessionId,
            userId,
            error: error.message,
            stack: error.stack
        });
        throw error;
    } finally {
        session.endSession();
    }
});



/**
 * Manual payment retry for failed sessions
 */
export const retrySessionPayment = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    console.log(`🔄 Manual payment retry for session: ${sessionId}`);

    const chatSession = await ChatSession.findOne({ sessionId });
    if (!chatSession) {
        throw new ApiError(404, "Chat session not found");
    }

    if (chatSession.paymentStatus === "PAID") {
        throw new ApiError(400, "Payment already processed for this session");
    }

    if (!chatSession.reservationId) {
        throw new ApiError(400, "No reservation found for this session");
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        let paymentResult;
        try {
            paymentResult = await WalletService.processSessionPayment(chatSession.reservationId);
        } catch (paymentError) {
            // Update session with failure details
            chatSession.paymentError = {
                message: paymentError.message,
                code: paymentError.statusCode || 500,
                timestamp: new Date(),
                retryAttempt: (chatSession.paymentError?.retryAttempt || 0) + 1
            };
            await chatSession.save({ session });
            await session.commitTransaction();

            throw new ApiError(500, `Payment retry failed: ${paymentError.message}`);
        }

        // Update session with successful payment
        chatSession.paymentStatus = "PAID";
        chatSession.astrologerEarnings = paymentResult.astrologerEarnings;
        chatSession.paymentError = undefined; // Clear any previous errors
        await chatSession.save({ session });

        await session.commitTransaction();

        console.log(`✅ Manual payment retry successful for session: ${sessionId}`);

        return res.status(200).json(new ApiResponse(200, {
            sessionId: chatSession.sessionId,
            paymentStatus: "PAID",
            astrologerEarnings: chatSession.astrologerEarnings,
            totalCost: paymentResult.totalCost
        }, "Payment processed successfully"));

    } catch (error) {
        await session.abortTransaction();
        console.error("❌ Manual payment retry failed:", error);
        throw error;
    } finally {
        session.endSession();
    }
});

/** * @desc    Pause chat session (when astrologer steps away)
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

/**
 * @desc    Get session billing details
 */
export const getSessionBilling = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const chatSession = await ChatSession.findOne({
        sessionId,
        $or: [{ userId }, { astrologerId: userId }]
    }).select("sessionId ratePerMinute billedDuration totalCost status startedAt lastActivityAt");

    if (!chatSession) {
        throw new ApiError(404, "Chat session not found");
    }

    const billingDetails = {
        sessionId: chatSession.sessionId,
        ratePerMinute: chatSession.ratePerMinute,
        billedDuration: chatSession.billedDuration,
        billedMinutes: Math.ceil(chatSession.billedDuration / 60),
        currentCost: chatSession.calculateCurrentCost(),
        totalCost: chatSession.totalCost,
        status: chatSession.status,
        sessionStart: chatSession.startedAt,
        lastActivity: chatSession.lastActivityAt
    };

    return res.status(200).json(
        new ApiResponse(200, billingDetails, "Billing details retrieved successfully")
    );
});



/**
 * Get all chat sessions for astrologer with filtering
 */
export const getAstrologerSessions = async (req, res) => {
    try {
        const astrologerId = req.user.id;
        const {
            page = 1,
            limit = 10,
            status,
            dateFrom,
            dateTo,
            sortBy = "createdAt",
            sortOrder = "desc",
            search
        } = req.query;

        // Build filter object
        const filter = { astrologerId };

        // Status filter
        if (status && status !== "ALL") {
            if (status === "ACTIVE_SESSIONS") {
                filter.status = { $in: ["REQUESTED", "ACCEPTED", "ACTIVE", "PAUSED"] };
            } else if (status === "COMPLETED_SESSIONS") {
                filter.status = "COMPLETED";
            } else {
                filter.status = status;
            }
        }

        // Date range filter
        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) filter.createdAt.$lte = new Date(dateTo);
        }

        // Search filter (by sessionId or user details)
        if (search) {
            filter.$or = [
                { sessionId: { $regex: search, $options: "i" } },
                { "meta.userName": { $regex: search, $options: "i" } }
            ];
        }

        // Pagination options
        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { [sortBy]: sortOrder === "desc" ? -1 : 1 },
            populate: [
                {
                    path: "userId",
                    select: "fullName gender email phone"
                }
            ]
        };

        // Execute query with pagination
        const sessions = await ChatSession.find(filter)
            .populate("userId", "fullName gender email phone")
            .sort(options.sort)
            .limit(options.limit * 1)
            .skip((options.page - 1) * options.limit)
            .exec();

        // Get total count for pagination
        const total = await ChatSession.countDocuments(filter);

        // Format response
        const formattedSessions = sessions.map(session => ({
            _id: session._id,
            sessionId: session.sessionId,
            requestId: session.meta?.requestId,
            user: session.userId,
            status: session.status,
            ratePerMinute: session.ratePerMinute,
            currency: session.currency,
            totalCost: session.totalCost,
            astrologerEarnings: session.astrologerEarnings,
            totalDuration: session.totalDuration,
            activeDuration: session.activeDuration,
            requestedAt: session.requestedAt,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            userRating: session.userRating,
            paymentStatus: session.paymentStatus,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt
        }));

        res.json({
            success: true,
            data: formattedSessions,
            pagination: {
                currentPage: options.page,
                totalPages: Math.ceil(total / options.limit),
                totalSessions: total,
                hasNext: options.page < Math.ceil(total / options.limit),
                hasPrev: options.page > 1
            }
        });

    } catch (error) {
        console.error("Get sessions error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch sessions",
            error: error.message
        });
    }
};



/**
 * Get session statistics for astrologer
 */
export const getSessionStats = async (req, res) => {
    try {
        const astrologerId = req.user.id;
        const { period = "month" } = req.query; // day, week, month, year

        const dateFilter = getDateFilter(period);

        const stats = await ChatSession.aggregate([
            {
                $match: {
                    astrologerId: new mongoose.Types.ObjectId(astrologerId),
                    createdAt: dateFilter
                }
            },
            {
                $group: {
                    _id: null,
                    totalSessions: { $sum: 1 },
                    completedSessions: {
                        $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] }
                    },
                    activeSessions: {
                        $sum: {
                            $cond: [
                                { $in: ["$status", ["ACTIVE", "PAUSED"]] },
                                1,
                                0
                            ]
                        }
                    },
                    totalEarnings: { $sum: "$astrologerEarnings" },
                    totalDuration: { $sum: "$activeDuration" },
                    averageRating: { $avg: "$userRating.stars" }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalSessions: 1,
                    completedSessions: 1,
                    activeSessions: 1,
                    totalEarnings: { $round: ["$totalEarnings", 2] },
                    totalDuration: 1,
                    averageRating: { $round: ["$averageRating", 1] }
                }
            }
        ]);

        // Get session status distribution
        const statusDistribution = await ChatSession.aggregate([
            {
                $match: {
                    astrologerId: new mongoose.Types.ObjectId(astrologerId),
                    createdAt: dateFilter
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        const defaultStats = {
            totalSessions: 0,
            completedSessions: 0,
            activeSessions: 0,
            totalEarnings: 0,
            totalDuration: 0,
            averageRating: 0
        };

        res.json({
            success: true,
            data: {
                overview: stats[0] || defaultStats,
                statusDistribution,
                period
            }
        });

    } catch (error) {
        console.error("Get session stats error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch session statistics",
            error: error.message
        });
    }
};

// Helper function for date filtering
function getDateFilter(period) {
    const now = new Date();
    let startDate = new Date();

    switch (period) {
        case "day":
            startDate.setDate(now.getDate() - 1);
            break;
        case "week":
            startDate.setDate(now.getDate() - 7);
            break;
        case "month":
            startDate.setMonth(now.getMonth() - 1);
            break;
        case "year":
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        default:
            startDate.setMonth(now.getMonth() - 1);
    }

    return { $gte: startDate, $lte: now };
}




// Enhanced billing timer with better error handling
const startBillingTimer = async (sessionId, chatId, ratePerMinute, reservationId) => {
    if (billingTimers.has(sessionId)) {
        console.log(`Billing already active for session: ${sessionId}`);
        return;
    }

    console.log(`Starting billing timer for session: ${sessionId}`);

    const interval = setInterval(async () => {
        try {
            const session = await ChatSession.findOne({ sessionId, status: "ACTIVE" });

            if (!session) {
                stopBillingTimer(sessionId);
                return;
            }

            // Update billed duration (only if session is active)
            const updateResult = await ChatSession.findByIdAndUpdate(
                session._id,
                {
                    $inc: { billedDuration: 60 }, // Add 60 seconds
                    lastActivityAt: new Date()
                },
                { new: true }
            );

            if (!updateResult) {
                stopBillingTimer(sessionId);
                return;
            }

            // Calculate current cost
            const currentCost = updateResult.calculateCurrentCost();

            // Update wallet reservation if needed
            if (currentCost > (updateResult.ratePerMinute * 10)) { // If exceeded initial reservation
                await WalletService.adjustReservation({
                    reservationId,
                    additionalAmount: updateResult.ratePerMinute * 5 // Reserve additional 5 minutes
                });
            }

            // Notify clients about billing update
            emitSocketEvent(
                chatId.toString(),
                ChatEventsEnum.BILLING_UPDATE_EVENT,
                {
                    sessionId,
                    billedDuration: updateResult.billedDuration,
                    currentCost,
                    ratePerMinute,
                    nextBillingIn: 60
                }
            );

            console.log(`Billed session ${sessionId}: ${updateResult.billedDuration}s, ₹${currentCost}`);

        } catch (error) {
            console.error(`Billing error for session ${sessionId}:`, error);
            stopBillingTimer(sessionId);
        }
    }, 60000); // Every minute

    billingTimers.set(sessionId, {
        interval,
        startedAt: new Date(),
        reservationId
    });
};

const stopBillingTimer = (sessionId) => {
    const timer = billingTimers.get(sessionId);
    if (timer) {
        clearInterval(timer.interval);
        billingTimers.delete(sessionId);
        console.log(`Stopped billing for session: ${sessionId}`);
    }
};

// Utility function to notify astrologer
const notifyAstrologerAboutRequest = async (req, astrologerId, requestData) => {
    // Socket notification
    emitSocketEvent(req, astrologerId.toString(), ChatEventsEnum.CHAT_REQUEST_EVENT, requestData);

    // Push notification
    await sendNotification({
        userId: astrologerId,
        title: "New Chat Request",
        message: `${requestData.userInfo.fullName} wants to chat with you`,
        type: "chat_request",
        data: {
            requestId: requestData.requestId,
            sessionId: requestData.sessionId,
            userId: requestData.userId,
            ratePerMinute: requestData.ratePerMinute
        }
    });
};

// Export billing timers for external management
export { billingTimers };


export const sendNotification = async ({
    userId,
    title,
    message,
    type,
    data = {}
}) => {
    try {
        // Get user's device tokens
        const user = await User.findById(userId).select("deviceTokens");

        if (!user || !user.deviceToken?.length) {
            console.log("User has no device tokens");
            return;
        }

        const payload = {
            notification: {
                title: title,
                body: message,
            },
            data: {
                type: type || "",
                ...Object.keys(data).reduce((acc, key) => {
                    acc[key] = String(data[key]);
                    return acc;
                }, {})
            }
        };

        const tokens = user.deviceToken;

        console.log("Sending Firebase notification to:", tokens);

        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            ...payload,
        });

        // Remove invalid tokens
        const invalidTokens = [];
        response.responses.forEach((res, index) => {
            if (!res.success) {
                invalidTokens.push(tokens[index]);
            }
        });

        if (invalidTokens.length) {
            await User.findByIdAndUpdate(userId, {
                $pull: { deviceTokens: { $in: invalidTokens } }
            });
            console.log("Removed invalid tokens:", invalidTokens);
        }

        console.log("Notification sent!");
        return response;

    } catch (error) {
        console.error("Error sending Firebase notification:", error);
    }
};
