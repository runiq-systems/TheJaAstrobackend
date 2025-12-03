import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import User from "../models/user.model.js";
import Call from "../models/call.js";
import { notifyAstrologerAboutCallRequest } from "../utils/notification.utils.js"; // You'll create this
import mongoose from "mongoose";
import { ChatEventsEnum } from "../../constants.js";

export const requestCallSession = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { astrologerId, callType = "AUDIO", userMessage } = req.body;
        const userId = req.user.id;

        if (!astrologerId) {
            throw new ApiError(400, "Astrologer ID is required");
        }

        if (astrologerId.toString() === userId.toString()) {
            throw new ApiError(400, "Cannot call yourself");
        }

        if (!["AUDIO", "VIDEO"].includes(callType)) {
            throw new ApiError(400, "Invalid call type. Must be AUDIO or VIDEO");
        }

        // -----------------------------------------
        // Validate Astrologer
        // -----------------------------------------
        const astrologer = await User.findOne({
            _id: astrologerId,
            role: "astrologer",
            userStatus: "Active",
            isSuspend: false
        })
            .session(session)
            .select("fullName phone avatar callRate isOnline");

        if (!astrologer) {
            throw new ApiError(404, "Astrologer not found or unavailable");
        }

        if (!astrologer.isOnline) {
            throw new ApiError(400, "Astrologer is currently offline");
        }

        const ratePerMinute = astrologer.callRate || 50; // fallback rate
        const newExpires = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes ringing timeout (shorter than chat)

        // -----------------------------------------
        // 1. Check for Existing Active/Initiated Call
        // -----------------------------------------
        const existingActiveCall = await Call.findActiveCall(userId, astrologerId).session(session);

        if (existingActiveCall) {
            // Extend expiry (though Call model doesn't have expiresAt, we simulate via status timeout later)
            // Optionally update startTime to now to reset timeout logic on frontend/socket
            await Call.updateOne(
                { _id: existingActiveCall._id },
                { 
                    startTime: new Date(), // reset ringing timer
                    callType // in case user switched from AUDIO to VIDEO
                },
                { session }
            );

            await session.commitTransaction();

            return res.status(200).json(
                new ApiResponse(200, {
                    callId: existingActiveCall._id,
                    status: existingActiveCall.status,
                    callType: existingActiveCall.callType,
                    expiresAt: new Date(Date.now() + 3 * 60 * 1000),
                    message: "Existing call request refreshed"
                }, "Call request already active – refreshed")
            );
        }

        // -----------------------------------------
        // 2. Create New Call Request (INITIATED → RINGING soon via socket)
        // -----------------------------------------
        const call = await Call.create([{
            userId,
            astrologerId,
            callType,
            direction: "USER_TO_ASTROLOGER",
            status: "INITIATED",
            startTime: new Date(),
            chargesPerMinute: ratePerMinute,
            userMessage: userMessage?.trim() || null
        }], { session });

        const callDoc = call[0];

        await session.commitTransaction();

        // Populate user & astrologer info
        await callDoc.populate([
            { path: "userId", select: "fullName avatar phone" },
            { path: "astrologerId", select: "fullName avatar phone callRate" }
        ]);

        // Notify astrologer via socket + push (same pattern as chat)
        await notifyAstrologerAboutCallRequest(req, astrologerId, {
            callId: callDoc._id,
            callType,
            userId,
            userInfo: req.user,
            userMessage,
            ratePerMinute,
            expiresInSeconds: 180, // 3 mins
            requestedAt: callDoc.startTime
        });

        return res.status(201).json(
            new ApiResponse(201, {
                callId: callDoc._id,
                status: "INITIATED",
                callType,
                ratePerMinute,
                astrologerInfo: {
                    fullName: astrologer.fullName,
                    phone: astrologer.phone,
                    avatar: astrologer.avatar,
                    callRate: astrologer.callRate
                },
                expiresAt: {
                    initiatedAt: callDoc.startTime,
                    expiresAt: newExpires
                }
            }, "Call request sent successfully")
        );

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
});


export const startCallSession = asyncHandler(async (req, res) => {
    const { callId } = req.params; // callId is the Mongo _id from requestCallSession
    const userId = req.user.id; // this is the USER (caller)

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        console.log(`Starting call session: ${callId} initiated by user: ${userId}`);

        // Find the call (must be in RINGING or CONNECTED state)
        const call = await Call.findOne({
            _id: callId,
            userId, // Only the user who initiated can "start" it after astrologer accepts
            status: { $in: ["RINGING", "CONNECTED"] },
        }).session(session);

        if (!call) {
            throw new ApiError(404, "Call not found or cannot be started");
        }

        // Prevent double-start
        if (call.status === "CONNECTED") {
            await session.commitTransaction();
            return res.status(200).json(
                new ApiResponse(200, {
                    callId: call._id,
                    status: "CONNECTED",
                    connectTime: call.connectTime,
                    message: "Call already connected"
                })
            );
        }

        // Estimate initial duration: 10 minutes (same as chat)
        const estimatedMinutes = 10;
        const estimatedCost = call.chargesPerMinute * estimatedMinutes;

        if (estimatedCost <= 0) {
            throw new ApiError(400, "Invalid call rate");
        }

        // Check user wallet balance
        const balanceCheck = await WalletService.checkBalance({
            userId,
            amount: estimatedCost,
            currency: "INR",
        });

        if (!balanceCheck.hasSufficientBalance) {
            // Optionally auto-mark call as FAILED due to low balance
            call.status = "FAILED";
            call.endTime = new Date();
            await call.save({ session });

            await session.commitTransaction();

            throw new ApiError(402, "Insufficient balance to start call", {
                shortfall: balanceCheck.shortfall,
                available: balanceCheck.availableBalance,
                required: estimatedCost,
            });
        }

        // Calculate commission (same logic as chat)
        const commissionDetails = await calculateCommission(
            call.astrologerId,
            "CALL",
            estimatedCost,
            {
                callId: call._id,
                callType: call.callType,
                estimatedMinutes
            }
        );

        // Create reservation
        const reservation = await Reservation.create([{
            reservationId: generateTxId("RES"),
            userId: call.userId,
            astrologerId: call.astrologerId,
            sessionType: "CALL",
            callType: call.callType,
            ratePerMinute: call.chargesPerMinute,
            currency: "INR",
            commissionPercent: commissionDetails.finalCommissionPercent,
            lockedAmount: estimatedCost,
            totalCost: estimatedCost,
            platformEarnings: commissionDetails.platformAmount,
            astrologerEarnings: commissionDetails.astrologerAmount,
            status: "RESERVED",
            startAt: new Date(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours max
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
                callId: call._id,
                estimatedMinutes,
                reservationFor: "INITIAL_CALL"
            }
        }], { session });

        // Reserve amount in wallet
        await WalletService.reserveAmount({
            userId,
            amount: estimatedCost,
            currency: "INR",
            reservationId: reservation[0]._id,
            sessionType: "CALL",
            description: `Initial reservation for ${call.callType.toLowerCase()} call (${estimatedMinutes} mins)`,
        });

        // Mark call as CONNECTED
        await call.markConnected(); // uses your model method
        call.paymentStatus = "RESERVED";
        call.reservationId = reservation[0]._id;
        await call.save({ session });

        await session.commitTransaction();
        console.log(`Call connected: ${callId}, reservation: ${reservation[0].reservationId}`);

        // Start real-time per-minute billing
        try {
            await startCallBillingTimer(
                call._id,
                call.userId,
                call.astrologerId,
                call.chargesPerMinute,
                reservation[0]._id,
                call.callType
            );
        } catch (err) {
            console.error("Failed to start call billing timer:", err);
            // Don't fail the call start — billing can recover later
        }

        // Notify both parties via socket that call is now LIVE
        const payload = {
            callId: call._id,
            status: "CONNECTED",
            connectTime: call.connectTime,
            ratePerMinute: call.chargesPerMinute,
            estimatedCost,
            reservedMinutes: estimatedMinutes,
            reservedAmount: estimatedCost,
            reservationId: reservation[0]._id,
            reservationNumber: reservation[0].reservationId,
        };

        // Emit to personal rooms
        emitSocketEvent(req, call.userId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);
        emitSocketEvent(req, call.astrologerId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);

        // Also emit to a shared call room (optional but recommended)
        emitSocketEvent(req, `call_${call._id}`, ChatEventsEnum.CALL_CONNECTED, payload);

        return res.status(200).json(
            new ApiResponse(200, {
                callId: call._id,
                status: "CONNECTED",
                callType: call.callType,
                connectTime: call.connectTime,
                ratePerMinute: call.chargesPerMinute,
                estimatedCost,
                reservedForMinutes: estimatedMinutes,
                reservationId: reservation[0]._id,
                reservationNumber: reservation[0].reservationId,
                message: "Call connected successfully",
            }, "Call started and billing activated")
        );

    } catch (error) {
        await session.abortTransaction();
        console.error("Call start failed:", error);

        // If failed before connection, mark as FAILED
        if (call && ["RINGING", "INITIATED"].includes(call?.status)) {
            call.status = "FAILED";
            call.endTime = new Date();
            await call.save();
        }

        throw error;
    } finally {
        session.endSession();
    }
});