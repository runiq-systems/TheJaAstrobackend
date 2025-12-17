// controllers/chatapp/chatController.js
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { Chat } from "../../models/chatapp/chat.js";
import { User } from "../../models/user.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { WalletService } from "../Wallet/walletIntegrationController.js";
import { emitSocketEvent, emitSocketEventGlobal } from "../../socket/index.js";
import { ChatEventsEnum } from "../../constants.js";
import mongoose from "mongoose";
import admin from "../../utils/firabse.js";
import { Astrologer } from "../../models/astrologer.js";

import { Reservation, calculateCommission, generateTxId } from "../../models/Wallet/AstroWallet.js";
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

        if (!astrologerId) {
            throw new ApiError(400, "Astrologer ID is required");
        }

        if (astrologerId.toString() === userId.toString()) {
            throw new ApiError(400, "Cannot start chat with yourself");
        }

        const astro = await Astrologer.findOne({
            userId: astrologerId
        })
        // -----------------------------------------
        // 🌟 Validate astrologer
        // -----------------------------------------
        const astrologer = await User.findOne({
            _id: astrologerId,
            role: "astrologer",
            userStatus: "Active",
            isSuspend: false
        })
            .session(session)
            .select("fullName phone avatar chatRate isOnline");

        if (!astrologer) {
            throw new ApiError(404, "Astrologer not found or unavailable");
        }

        if (!astro) {
            throw new ApiError(404, "Astrologer profile not completed");
        }
        if (!astrologer.isOnline) {
            throw new ApiError(400, "Astrologer is currently offline");
        }

        const newExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

        // -----------------------------------------
        // 🔥 1. CHECK EXISTING ACTIVE SESSION
        // -----------------------------------------
        const existingSession = await ChatSession.findOne({
            userId,
            astrologerId,
            status: { $in: ["REQUESTED", "ACTIVE"] }
        }).session(session);

        if (existingSession) {
            // ⭐ Force update TTL expiry for session
            await ChatSession.updateOne(
                { _id: existingSession._id },
                { $set: { expiresAt: newExpires } },
                { session }
            );

            // ⭐ Reset matching request too
            if (existingSession.meta?.request_Id) {
                await ChatRequest.updateOne(
                    { _id: existingSession.meta.request_Id },
                    { $set: { expiresAt: newExpires } },
                    { session }
                );
            }

            await session.commitTransaction();

            return res.status(200).json(
                new ApiResponse(200, {
                    sessionId: existingSession.sessionId,
                    status: existingSession.status,
                    expiresAt: newExpires,
                    message: "Existing session expiry extended"
                })
            );
        }

        // -----------------------------------------
        // 🔥 2. CHECK EXISTING PENDING REQUEST
        // -----------------------------------------
        const existingPending = await ChatRequest.findOne({
            userId,
            astrologerId,
            status: "PENDING"
        }).session(session);

        if (existingPending) {
            // ⭐ Reset request expiry
            await ChatRequest.updateOne(
                { _id: existingPending._id },
                { $set: { expiresAt: newExpires } },
                { session }
            );

            await session.commitTransaction();

            return res.status(200).json(
                new ApiResponse(200, {
                    requestId: existingPending.requestId,
                    expiresAt: newExpires,
                    message: "Existing request expiry extended"
                })
            );
        }

        // -----------------------------------------
        // 🌟 3. CREATE NEW CHAT + REQUEST + SESSION
        // -----------------------------------------
        const chat = await Chat.findOrCreatePersonalChat(userId, astrologerId);

        const requestId = ChatRequest.generateRequestId();
        const sessionId = ChatSession.generateSessionId();
        const ratePerMinute = astrologer.chatRate || astro.ratepermin || 10;

        // const ratePerMinute = astrologer.chatRate || 10;

        const request = await ChatRequest.create(
            [
                {
                    requestId,
                    userId,
                    astrologerId,
                    userMessage: userMessage?.trim(),
                    chatType,
                    expiresAt: newExpires,
                    meta: {
                        chatId: chat._id,
                        ratePerMinute
                    }
                }
            ],
            { session }
        );

        const chatSession = await ChatSession.create(
            [
                {
                    sessionId,
                    userId,
                    astrologerId,
                    chatId: chat._id,
                    ratePerMinute,
                    status: "REQUESTED",
                    requestedAt: new Date(),
                    expiresAt: newExpires,
                    meta: {
                        request_Id: request[0]._id,
                        requestId: request[0].requestId,
                        chatId: chat._id,
                        chatType
                    }
                }
            ],
            { session }
        );

        // Link session ID to request
        await ChatRequest.updateOne(
            { _id: request[0]._id },
            { sessionId: chatSession[0]._id },
            { session }
        );

        await session.commitTransaction();

        // Populate final response
        await chatSession[0].populate([
            { path: "userId", select: "fullName phone avatar" },
            { path: "astrologerId", select: "fullName phone avatar chatRate" }
        ]);

        await notifyAstrologerAboutRequest(req, astrologerId, {
            requestId,
            sessionId,
            userId,
            userInfo: req.user,
            userMessage,
            ratePerMinute,
            expiresAt: newExpires
        });

        return res.status(201).json(
            new ApiResponse(201, {
                requestId,
                sessionId,
                status: "REQUESTED",
                ratePerMinute,
                expiresAt: newExpires,
                astrologerInfo: {
                    fullName: astrologer.fullName,
                    phone: astrologer.phone,
                    chatRate: astrologer.chatRate || astro.ratepermin || 10,
                }
            })
        );

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
});


/**
 * @desc    Enhanced session start with better validation
 */
export const startChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        console.log(`🚀 Starting session: ${sessionId} for user: ${userId}`);

        // Find the chat session
        const chatSession = await ChatSession.findOne({
            sessionId,
            $or: [{ userId }, { astrologerId: userId }],
            status: "ACCEPTED",
        }).session(session);

        if (!chatSession) {
            throw new ApiError(404, "Chat session not found or not ready to start");
        }

        // Verify user is the one who can start the session
        if (chatSession.userId.toString() !== userId.toString()) {
            throw new ApiError(403, "Only the user can start the chat session");
        }

        const astro = await Astrologer.findOne({

        })

        // Estimate initial cost
        const estimatedMinutes = 10;
        const estimatedCost = chatSession.ratePerMinute * estimatedMinutes;

        if (estimatedCost <= 0) {
            throw new ApiError(400, "Invalid session rate");
        }

        // Check balance
        const balanceCheck = await WalletService.checkBalance({
            userId: chatSession.userId,
            amount: estimatedCost,
            currency: "INR",
        });

        if (!balanceCheck.hasSufficientBalance) {
            throw new ApiError(402, "Insufficient balance to start chat session", {
                shortfall: balanceCheck.shortfall,
                available: balanceCheck.availableBalance,
                required: estimatedCost,
            });
        }

        // Calculate commission and create reservation (your existing code)
        const commissionDetails = await calculateCommission(
            chatSession.astrologerId,
            "CHAT",
            estimatedCost,
            {
                sessionId: chatSession.sessionId,
                estimatedMinutes: estimatedMinutes
            }
        );

        console.log(`💰 Creating reservation for session: ${sessionId}, Amount: ${estimatedCost}`);

        const reservation = await Reservation.create([{
            reservationId: generateTxId("RES"),
            userId: chatSession.userId,
            astrologerId: chatSession.astrologerId,
            sessionType: "CHAT",
            ratePerMinute: chatSession.ratePerMinute,
            currency: "INR",
            commissionPercent: commissionDetails.finalCommissionPercent,
            lockedAmount: estimatedCost,
            totalCost: estimatedCost,
            platformEarnings: commissionDetails.platformAmount,
            astrologerEarnings: commissionDetails.astrologerAmount,
            status: "RESERVED",
            startAt: new Date(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            commissionDetails: {
                baseCommissionPercent: commissionDetails.baseCommissionPercent,
                appliedOverrideId: commissionDetails.overrideId,
                finalCommissionPercent: commissionDetails.finalCommissionPercent,
                commissionRuleId: commissionDetails.appliedRuleId,
                commissionAmount: commissionDetails.commissionAmount,
                platformAmount: commissionDetails.platformAmount,
                astrologerAmount: commissionDetails.astrologerAmount
            },
            meta: {
                sessionId: chatSession.sessionId,
                chatId: chatSession.chatId,
                estimatedMinutes: estimatedMinutes,
                chatSessionId: chatSession._id
            }
        }], { session });

        console.log(`📝 Reservation created: ${reservation[0]._id}`);

        // Reserve the amount from user's wallet
        const reservationResult = await WalletService.reserveAmount({
            userId: chatSession.userId,
            amount: estimatedCost,
            currency: "INR",
            reservationId: reservation[0]._id,
            sessionType: "CHAT",
            description: `Initial reservation for chat session with astrologer (${estimatedMinutes} mins)`,
        });

        // Update chat session status to ACTIVE
        chatSession.status = "ACTIVE";
        chatSession.startedAt = new Date();
        chatSession.lastActivityAt = new Date();
        chatSession.paymentStatus = "RESERVED";
        chatSession.reservationId = reservation[0]._id;
        await chatSession.save({ session });

        await session.commitTransaction();

        console.log(`✅ Session started successfully: ${sessionId}`);

        // Start billing timer
        try {
            await startBillingTimer(
                chatSession.sessionId,
                chatSession.chatId,
                chatSession.ratePerMinute,
                reservation[0]._id
            );
        } catch (err) {
            console.error("Failed to start billing timer:", err);
        }

        // ✅ CRITICAL: Notify both user and astrologer via socket
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
                reservationId: reservation[0].reservationId
            }
        );

        // Also notify via user's personal room for reliability
        emitSocketEvent(
            req,
            chatSession.userId.toString(),
            ChatEventsEnum.SESSION_STARTED_EVENT,
            {
                sessionId: chatSession.sessionId,
                status: "ACTIVE",
                startedAt: new Date()
            }
        );

        return res.status(200).json(
            new ApiResponse(200, {
                sessionId: chatSession.sessionId,
                chatId: chatSession.chatId,
                status: "ACTIVE",
                startedAt: chatSession.startedAt,
                ratePerMinute: chatSession.ratePerMinute,
                estimatedCost,
                reservedForMinutes: estimatedMinutes,
                reservationId: reservation[0]._id,
                reservationNumber: reservation[0].reservationId,
                message: "Chat session started successfully",
            }, "Chat session started successfully")
        );
    } catch (error) {
        await session.abortTransaction();
        console.error("❌ Session start failed:", error);
        throw error;
    } finally {
        session.endSession();
    }
});

/**
 * @desc    Enhanced accept request with socket notifications
 */
export const acceptChatRequest = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const { requestId } = req.params;
        const astrologerId = req.user.id;

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

        console.log(`✅ Chat request accepted: ${requestId} -> session: ${chatSession.sessionId}`);

        // ✅ CRITICAL: Notify user via socket in chat room AND personal room
        emitSocketEvent(req, chatSession.chatId.toString(), ChatEventsEnum.CHAT_ACCEPTED_EVENT, {
            requestId: chatRequest.requestId,
            sessionId: chatSession.sessionId,
            astrologerId: astrologerId,
            astrologerInfo: {
                fullName: req.user.fullName,
                phone: req.user.phone,
                avatar: req.user.avatar
            },
            acceptedAt: now
        });

        // Also send to user's personal room for reliability
        emitSocketEvent(req, chatRequest.userId.toString(), ChatEventsEnum.CHAT_ACCEPTED_EVENT, {
            requestId: chatRequest.requestId,
            sessionId: chatSession.sessionId,
            astrologerId: astrologerId,
            astrologerInfo: {
                fullName: req.user.fullName,
                phone: req.user.phone,
                avatar: req.user.avatar
            },
            acceptedAt: now
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
                astrologerId: astrologerId,
                chatId: chatSession.chatId
            }
        });

        return res.status(200).json(
            new ApiResponse(200, {
                requestId: chatRequest.requestId,
                sessionId: chatSession.sessionId,
                status: "ACCEPTED",
                chatId: chatSession.chatId
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
// In controllers/chatapp/chatController.js → Replace endChatSession





export const endChatSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const requesterId = req.user._id; // can be astrologer or user

    const session = await mongoose.startSession();
    let hasCommitted = false;

    try {
        session.startTransaction();

        // 1️⃣ Find active chat session
        const chatSession = await ChatSession.findOne({
            sessionId,
            status: { $in: ["ACTIVE", "PAUSED"] },
        }).session(session);

        if (!chatSession) {
            await session.abortTransaction();
            return res
                .status(200)
                .json(new ApiResponse(200, {}, "Chat already ended or not active"));
        }

        // 2️⃣ Prevent duplicate ending
        if (chatSession.endedAt) {
            await session.abortTransaction();
            return res
                .status(200)
                .json(new ApiResponse(200, {}, "Chat session already ended"));
        }

        // 3️⃣ Determine who ended
        const isAstrologer = requesterId.toString() === chatSession.astrologerId.toString();
        const isUser = requesterId.toString() === chatSession.userId.toString();
        if (!isAstrologer && !isUser) {
            throw new ApiError(403, "You are not part of this session");
        }

        // 4️⃣ Stop billing safely
        try {
            stopBillingTimer(sessionId);
        } catch (err) {
            console.warn(`[Timer Error] Failed to stop billing timer:`, err);
        }

        // 5️⃣ Calculate duration and cost
        const endedAt = new Date();
        const startedAt = chatSession.startedAt || endedAt;
        const totalSeconds = Math.max(1, Math.floor((endedAt - startedAt) / 1000));
        const billedMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
        const ratePerMinute = chatSession.ratePerMinute || 0;
        const totalCost = billedMinutes * ratePerMinute;

        // Platform & astrologer split (80/20)
        const platformEarnings = Math.round(totalCost * 0.20);
        const astrologerEarnings = totalCost - platformEarnings;

        console.log(`[END CHAT] ${isAstrologer ? "Astrologer" : "User"} ended session ${sessionId}`);
        console.log(`[BILL] Duration: ${totalSeconds}s (${(totalSeconds / 60).toFixed(2)} min)`);
        console.log(`[BILL] Total Cost: ₹${totalCost}`);

        // 6️⃣ Update ChatSession document
        chatSession.status = "COMPLETED";
        chatSession.endedAt = endedAt;
        chatSession.totalDuration = totalSeconds;
        chatSession.billedDuration = billedMinutes * 60;
        chatSession.totalCost = totalCost;
        chatSession.endedBy = requesterId;

        // 7️⃣ Settlement variables
        let refundedAmount = 0;
        let settlementMessage = "No reservation found";

        // 8️⃣ Handle reservation settlement (wallet-based)
        if (chatSession.reservationId) {
            try {
                const reservation = await Reservation.findById(chatSession.reservationId).session(session);
                if (reservation) {
                    const reservedAmount = reservation.lockedAmount || 0;
                    const usedAmount = totalCost;

                    refundedAmount = Math.max(0, reservedAmount - usedAmount);

                    // 💰 Step 1: Release locked to available
                    await WalletService.releaseAmount({
                        userId: chatSession.userId,
                        amount: reservedAmount,
                        currency: "INR",
                        reservationId: reservation._id,
                        description: `Release ₹${reservedAmount} locked for chat`,
                        session,
                    });

                    // 💸 Step 2: Debit actual used amount
                    if (usedAmount > 0) {
                        await WalletService.debit({
                            userId: chatSession.userId,
                            amount: usedAmount,
                            currency: "INR",
                            category: "CHAT_SESSION",
                            subcategory: "CHAT",
                            description: `Chat ${billedMinutes} min × ₹${ratePerMinute}/min`,
                            reservationId: reservation._id,
                            meta: {
                                sessionId,
                                billedMinutes,
                                duration: totalSeconds,
                                astrologerId: chatSession.astrologerId,
                            },
                            session,
                        });
                    }

                    // 💼 Step 3: Credit astrologer earnings (only if duration > 5s)
                    if (astrologerEarnings > 0 && totalSeconds > 5) {
                        await WalletService.credit({
                            userId: chatSession.astrologerId,
                            amount: astrologerEarnings,
                            currency: "INR",
                            category: "EARNINGS",
                            subcategory: "CHAT_SESSION",
                            description: `Earnings from ${billedMinutes} min chat (₹${ratePerMinute}/min)`,
                            meta: {
                                sessionId,
                                commissionPercent: 20,
                            },
                            session,
                        });
                    }

                    // 💳 Step 4: If astrologer ended early, auto-refund user
                    if (isAstrologer && refundedAmount > 0) {
                        await WalletService.credit({
                            userId: chatSession.userId,
                            amount: refundedAmount,
                            currency: "INR",
                            category: "REFUND",
                            subcategory: "CHAT_END",
                            description: `Refund ₹${refundedAmount} for unused chat time`,
                            meta: { sessionId },
                            session,
                        });
                        settlementMessage = `Astrologer ended early. Refunded ₹${refundedAmount}`;
                    } else {
                        settlementMessage = "Chat settlement completed";
                    }

                    // Update reservation
                    reservation.status = "SETTLED";
                    reservation.totalCost = usedAmount;
                    reservation.platformEarnings = platformEarnings;
                    reservation.astrologerEarnings = astrologerEarnings;
                    reservation.refundedAmount = refundedAmount;
                    reservation.billedMinutes = billedMinutes;
                    reservation.totalDurationSec = totalSeconds;
                    reservation.settledAt = endedAt;
                    await reservation.save({ session });

                    // Update chat session
                    chatSession.platformCommission = platformEarnings;
                    chatSession.astrologerEarnings = astrologerEarnings;
                    chatSession.paymentStatus = "PAID";
                }
            } catch (err) {
                console.error("[SETTLEMENT ERROR]", err);
                throw new ApiError(500, "Settlement failed: " + err.message);
            }
        } else {
            chatSession.paymentStatus = "NO_RESERVATION";
        }

        // 9️⃣ Save updates
        await chatSession.save({ session });
        hasCommitted = true;
        await session.commitTransaction();

        // 🔔 10️⃣ Emit socket event
        const payload = {
            sessionId,
            status: "COMPLETED",
            endedBy: requesterId,
            totalCost,
            refundedAmount,
            billedMinutes,
            durationSeconds: totalSeconds,
            ratePerMinute,
            astrologerEarnings,
            platformEarnings,
            message: settlementMessage,
        };

        emitSocketEvent(req, chatSession.userId.toString(), ChatEventsEnum.SESSION_ENDED_EVENT, payload);
        emitSocketEvent(req, chatSession.astrologerId.toString(), ChatEventsEnum.SESSION_ENDED_EVENT, payload);

        // ✅ 11️⃣ Return API response
        return res
            .status(200)
            .json(new ApiResponse(200, payload, "Chat session ended successfully"));
    } catch (error) {
        if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
        console.error("[endChatSession ERROR]", error);
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



// Enhanced billing timer with proper session duration calculation
const startBillingTimer = async (sessionId, chatId, ratePerMinute, reservationId, estimatedMinutes = 10) => {
    if (billingTimers.has(sessionId)) {
        console.log(`Billing already active for session: ${sessionId}`);
        return;
    }

    console.log(`Starting billing timer for session: ${sessionId}, Estimated: ${estimatedMinutes} mins`);

    // Clear any existing timer first
    stopBillingTimer(sessionId);

    // Store session details for auto-end
    const sessionDurationMs = estimatedMinutes * 60 * 1000;
    const startedAt = new Date();

    // Set up auto-end timer
    const autoEndTimer = setTimeout(async () => {
        await handleSessionAutoEnd(sessionId, chatId, reservationId);
    }, sessionDurationMs);

    // Store auto-end timer
    autoEndTimers.set(sessionId, autoEndTimer);

    // Set up reminders (5 minutes, 2 minutes, 1 minute before end)
    setupSessionReminders(sessionId, chatId, estimatedMinutes);

    // Start per-minute billing interval
    const interval = setInterval(async () => {
        try {
            const session = await ChatSession.findOne({
                sessionId,
                status: { $in: ["ACTIVE", "PAUSED"] }
            });

            if (!session || session.status !== "ACTIVE") {
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

            // Calculate current cost based on actual billed duration
            const billedMinutes = Math.ceil(updateResult.billedDuration / 60);
            const currentCost = ratePerMinute * billedMinutes;

            // Update reservation with actual cost
            if (reservationId) {
                await Reservation.findByIdAndUpdate(
                    reservationId,
                    {
                        $set: {
                            totalCost: currentCost,
                            billedMinutes: billedMinutes,
                            totalDurationSec: updateResult.billedDuration,
                            status: "ONGOING"
                        }
                    }
                );
            }

            // Calculate time remaining
            const elapsedMs = (billedMinutes * 60 * 1000);
            const remainingMs = Math.max(0, sessionDurationMs - elapsedMs);
            const minutesRemaining = Math.ceil(remainingMs / (60 * 1000));

            // Check if session needs to be auto-ended (if no time left)
            if (remainingMs <= 0) {
                console.log(`Session ${sessionId} time limit reached, triggering auto-end`);
                await handleSessionAutoEnd(sessionId, chatId, reservationId);
                return;
            }

            // Send reminder at specific intervals
            if (minutesRemaining === 5 && !reminderSent.has(`${sessionId}_5min`)) {
                sendSessionReminder(sessionId, chatId, 5);
                reminderSent.set(`${sessionId}_5min`, true);
            }

            if (minutesRemaining === 2 && !reminderSent.has(`${sessionId}_2min`)) {
                sendSessionReminder(sessionId, chatId, 2);
                reminderSent.set(`${sessionId}_2min`, true);
            }

            if (minutesRemaining === 1 && !reminderSent.has(`${sessionId}_1min`)) {
                sendSessionReminder(sessionId, chatId, 1);
                reminderSent.set(`${sessionId}_1min`, true);
            }

            // Notify clients about billing update
            emitSocketEventGlobal(
                chatId,
                ChatEventsEnum.BILLING_UPDATE_EVENT,
                {
                    sessionId,
                    billedDuration: updateResult.billedDuration,
                    billedMinutes: billedMinutes,
                    currentCost,
                    ratePerMinute,
                    minutesRemaining,
                    nextBillingIn: 60
                }
            );

            console.log(`Billed session ${sessionId}: ${updateResult.billedDuration}s, ${billedMinutes}m, ₹${currentCost}, ${minutesRemaining} min remaining`);

        } catch (error) {
            console.error(`Billing error for session ${sessionId}:`, error);
            stopBillingTimer(sessionId);
        }
    }, 60000); // Every minute

    // Store the interval
    billingTimers.set(sessionId, {
        interval,
        startedAt,
        reservationId,
        chatId,
        ratePerMinute
    });

    // Immediately send first billing update
    emitSocketEventGlobal(
        chatId,
        ChatEventsEnum.BILLING_UPDATE_EVENT,
        {
            sessionId,
            billedDuration: 0,
            billedMinutes: 0,
            currentCost: 0,
            ratePerMinute,
            minutesRemaining: estimatedMinutes,
            nextBillingIn: 60
        }
    );
};

// Helper function to handle session auto-end
const handleSessionAutoEnd = async (sessionId, chatId, reservationId) => {
    try {
        const session = await ChatSession.findOne({ sessionId });
        if (!session || session.status !== "ACTIVE") return;

        // Stop billing timer
        stopBillingTimer(sessionId);

        // Update session status
        session.status = "AUTO_ENDED";
        session.endedAt = new Date();
        await session.save();

        // Process settlement if reservation exists
        if (reservationId) {
            try {
                await WalletService.processSessionPayment(reservationId);
                session.paymentStatus = "PAID";
                await session.save();
            } catch (paymentError) {
                console.error(`Payment settlement failed: ${paymentError.message}`);
                session.paymentStatus = "SETTLEMENT_FAILED";
                await session.save();
            }
        }
        // Notify both parties
        emitSocketEventGlobal(
            chatId,
            ChatEventsEnum.INSUFFICIENT_BALANCE_WARNING,
            {
                sessionId,
                status: "AUTO_ENDED",
                message: "Session auto-ended due to time limit"
            }
        );



        emitSocketEventGlobal(
            session.astrologerId.toString(),
            ChatEventsEnum.SESSION_ENDED_EVENT,
            {
                sessionId: session.sessionId,
                status: "COMPLETED",
                reason: "AUTO_ENDED",
                message: "Chat session auto-ended due to time limit."
            }
        );



        console.log(`Auto-ended session: ${sessionId}`);

    } catch (error) {
        console.error(`Failed to auto-end session ${sessionId}:`, error);
    }
};

// Send session reminder
const sendSessionReminder = async (sessionId, chatId, minutesRemaining) => {
    try {
        const session = await ChatSession.findOne({ sessionId })
            .populate("userId", "fullName")
            .populate("astrologerId", "fullName");

        if (!session) return;

        emitSocketEventGlobal(
            chatId,
            ChatEventsEnum.RESERVATION_ENDING_SOON,
            {
                sessionId,
                minutesRemaining,
                message: `Your chat session will end in ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`
            }
        );

        console.log(`Sent ${minutesRemaining} min reminder for session: ${sessionId}`);

    } catch (error) {
        console.error(`Failed to send reminder:`, error);
    }
};

// Setup session reminders
const setupSessionReminders = (sessionId, chatId, estimatedMinutes) => {
    // Clear any existing reminders
    clearReminders(sessionId);

    // Set reminders at 5, 2, and 1 minute marks
    const reminderTimes = [5, 2, 1];

    reminderTimes.forEach(minutes => {
        if (estimatedMinutes > minutes) {
            const reminderTimeMs = (estimatedMinutes - minutes) * 60 * 1000;
            const timer = setTimeout(() => {
                sendSessionReminder(sessionId, chatId, minutes);
            }, reminderTimeMs);

            reminderTimers.set(`${sessionId}_${minutes}min`, timer);
        }
    });
};

// Clear all reminders for a session
const clearReminders = (sessionId) => {
    reminderTimers.forEach((timer, key) => {
        if (key.startsWith(sessionId)) {
            clearTimeout(timer);
            reminderTimers.delete(key);
        }
    });

    // Clear reminder sent flags
    ['5min', '2min', '1min'].forEach(min => {
        reminderSent.delete(`${sessionId}_${min}`);
    });
};

// Global variables needed
const autoEndTimers = new Map();
const reminderTimers = new Map();
const reminderSent = new Map();

// Export for external use
export { billingTimers, autoEndTimers, reminderTimers };

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
// export { billingTimers };

export const sendNotification = async ({
    userId,
    title,
    message,
    type = "chat_message",
    data = {}
}) => {
    try {
        const user = await User.findById(userId).select("deviceToken fullName");

        if (!user || !user.deviceToken?.length) {
            console.log("User has no device tokens");
            return;
        }

        // Build individual messages for each token (required for sendEachForMulticast)
        const messages = user.deviceToken.map(token => ({
            token,
            data: {
                type,
                title,
                body: message,
                ...Object.keys(data).reduce((acc, key) => {
                    acc[key] = String(data[key]);
                    return acc;
                }, {})
            },
            android: {
                priority: "high",
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                        badge: 1,
                        'content-available': 1,
                    },
                },
            },
        }));

        console.log("Sending data-only chat notification to tokens:", user.deviceToken);

        // Modern method – works in v11.7+ (including latest v13+)
        const batchResponse = await admin.messaging().sendEachForMulticast(messages);

        // Invalid token cleanup
        const invalidTokens = [];
        batchResponse.responses.forEach((res, index) => {
            if (!res.success) {
                invalidTokens.push(user.deviceToken[index]);
            }
        });

        if (invalidTokens.length > 0) {
            await User.findByIdAndUpdate(userId, {
                $pull: { deviceToken: { $in: invalidTokens } }
            });
            console.log("Removed invalid tokens:", invalidTokens);
        }

        console.log(`Chat notification batch sent! Success: ${batchResponse.successCount}, Failure: ${batchResponse.failureCount}`);
        return batchResponse;

    } catch (error) {
        console.error("Error sending chat notification:", error);
    }
};