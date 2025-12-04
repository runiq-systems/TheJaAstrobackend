import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { User } from "../../models/user.js";
import mongoose from "mongoose";
import { ChatEventsEnum } from "../../constants.js";
import { Call } from "../../models/calllogs/call.js";
import { WalletService } from "../Wallet/walletIntegrationController.js";
import {
  calculateCommission,
  Reservation,
} from "../../models/Wallet/AstroWallet.js";
import { emitSocketEvent, emitSocketEventGlobal } from "../../socket/index.js";
import { sendNotification } from "../chatapp/messageController.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallRequest } from "../../models/calllogs/callRequest.js";
import { CallSession } from "../../models/calllogs/callSession.js";

const billingTimers = new Map();
const autoEndTimers = new Map();
const reminderTimers = new Map();
const reminderSent = new Map();

// utils/notification.utils.js or wherever you keep it

export const notifyAstrologerAboutCallRequest = async (req, astrologerId, payload) => {
  // 1. Socket notification – correct event for CALL
  emitSocketEvent(
    req,
    astrologerId.toString(),
    ChatEventsEnum.CALL_INITIATED_EVENT, // this is the right one
    {
      eventType: "incomingCall",
      requestId: payload.requestId,
      sessionId: payload.sessionId,
      callType: payload.callType,
      callerId: payload.callerId,
      callerName: payload.callerName,
      callerImage: payload.callerImage || "",
      ratePerMinute: payload.ratePerMinute,
      expiresAt: payload.expiresAt,
      timestamp: new Date(),
      message: payload.message || "Wants to connect via call",
    }
  );

  // 2. Push notification
  await sendNotification({
    userId: astrologerId,
    title: `Incoming ${payload.callType} Call`,
    message: `${payload.callerName} is calling you (₹${payload.ratePerMinute}/min)`,
    type: "incoming_call",
    data: {
      requestId: payload.requestId,
      sessionId: payload.sessionId,
      callType: payload.callType,
      callerId: payload.callerId,
      ratePerMinute: payload.ratePerMinute,
    },
  });
};
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
        // Validate astrologer
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

        const ratePerMinute = astrologer.callRate || 50;
        const newExpires = new Date(Date.now() + 3 * 60 * 1000);

        // 1. Check existing active session
        const existingSession = await CallSession.findOne({
            userId,
            astrologerId,
            status: { $in: ["REQUESTED", "ACCEPTED", "RINGING", "CONNECTED", "ACTIVE"] }
        }).session(session);

        if (existingSession) {
            // Extend expiry
            await CallSession.updateOne(
                { _id: existingSession._id },
                { $set: { expiresAt: newExpires } },
                { session }
            );

            if (existingSession.meta?.request_Id) {
                await CallRequest.updateOne(
                    { _id: existingSession.meta.request_Id },
                    { $set: { expiresAt: newExpires } },
                    { session }
                );
            }

            await session.commitTransaction();

            return res.status(200).json(new ApiResponse(200, {
                sessionId: existingSession.sessionId,
                status: existingSession.status,
                callType: existingSession.callType,
                expiresAt: newExpires,
                message: "Call request refreshed"
            }));
        }

        // 2. Check pending request
        const existingPending = await CallRequest.findOne({
            userId,
            astrologerId,
            status: "PENDING"
        }).session(session);

        if (existingPending) {
            await CallRequest.updateOne(
                { _id: existingPending._id },
                { $set: { expiresAt: newExpires } },
                { session }
            );
            await session.commitTransaction();
            return res.status(200).json(new ApiResponse(200, {
                requestId: existingPending.requestId,
                expiresAt: newExpires,
                message: "Pending call request extended"
            }));
        }

        // 3. Create NEW CallRequest + CallSession
        const requestId = CallRequest.generateRequestId();
        const sessionId = CallSession.generateSessionId();

        const callRequest = await CallRequest.create([{
            requestId,
            userId,
            astrologerId,
            callType,
            userMessage: userMessage?.trim() || null,
            ratePerMinute,
            status: "PENDING",
            requestedAt: new Date(),
            expiresAt: newExpires
        }], { session });

        const callSession = await CallSession.create([{
            sessionId,
            userId,
            astrologerId,
            callId: null,           // ← Now allowed!
            callType,
            ratePerMinute,
            currency: "INR",
            status: "REQUESTED",
            requestedAt: new Date(),
            expiresAt: newExpires,
            meta: {
                requestId,
                request_Id: callRequest[0]._id,
                callType
            }
        }], { session });

        // Link them
        await CallRequest.updateOne(
            { _id: callRequest[0]._id },
            { callSessionId: callSession[0]._id },
            { session }
        );

        await session.commitTransaction();

        // Notify astrologer
        await notifyAstrologerAboutRequest(req, astrologerId, {
            requestId,
            sessionId,
            callType,
            userId,
            userInfo: req.user,
            ratePerMinute,
            expiresAt: newExpires
        });

        return res.status(201).json(new ApiResponse(201, {
            requestId,
            sessionId,
            callType,
            status: "REQUESTED",
            ratePerMinute,
            expiresAt: newExpires,
            astrologerInfo: {
                fullName: astrologer.fullName,
                avatar: astrologer.avatar,
                callRate: astrologer.callRate
            }
        }, "Call request sent successfully"));

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
    console.log(
      `Starting call session: ${callId} initiated by user: ${userId}`
    );

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
          message: "Call already connected",
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
        estimatedMinutes,
      }
    );

    // Create reservation
    const reservation = await Reservation.create(
      [
        {
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
            astrologerAmount: commissionDetails.astrologerAmount,
          },
          meta: {
            callId: call._id,
            estimatedMinutes,
            reservationFor: "INITIAL_CALL",
          },
        },
      ],
      { session }
    );

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
    console.log(
      `Call connected: ${callId}, reservation: ${reservation[0].reservationId}`
    );

    // Start real-time per-minute billing
    try {
      await startBillingTimer(
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
    emitSocketEvent(
      req,
      call.userId.toString(),
      ChatEventsEnum.CALL_CONNECTED,
      payload
    );
    emitSocketEvent(
      req,
      call.astrologerId.toString(),
      ChatEventsEnum.CALL_CONNECTED,
      payload
    );

    // Also emit to a shared call room (optional but recommended)
    emitSocketEvent(
      req,
      `call_${call._id}`,
      ChatEventsEnum.CALL_CONNECTED,
      payload
    );

    return res.status(200).json(
      new ApiResponse(
        200,
        {
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
        },
        "Call started and billing activated"
      )
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

export const getAstrologerCallSessions = async (req, res) => {
  try {
    const astrologerId = req.user.id;

    const {
      page = 1,
      limit = 10,
      status, // e.g., CONNECTED, COMPLETED, MISSED, etc.
      dateFrom,
      dateTo,
      sortBy = "startTime",
      sortOrder = "desc",
      search, // search by callId, user name, phone
    } = req.query;

    // Build filter
    const filter = { astrologerId };

    // Status filter
    if (status && status !== "ALL") {
      if (status === "ACTIVE_CALLS") {
        filter.status = { $in: ["INITIATED", "RINGING", "CONNECTED"] };
      } else if (status === "COMPLETED_CALLS") {
        filter.status = "COMPLETED";
      } else {
        filter.status = status;
      }
    }

    // Date range (based on call start time)
    if (dateFrom || dateTo) {
      filter.startTime = {};
      if (dateFrom) filter.startTime.$gte = new Date(dateFrom);
      if (dateTo) filter.startTime.$lte = new Date(dateTo);
    }

    // Search: call _id, user fullName, phone
    if (search?.trim()) {
      filter.$or = [
        { _id: { $regex: search.trim(), $options: "i" } },
        { "user.fullName": { $regex: search.trim(), $options: "i" } },
        { "user.phone": { $regex: search.trim(), $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    // Main query with population
    const calls = await Call.find(filter)
      .populate("userId", "fullName avatar phone gender email")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // faster + easier to manipulate

    const total = await Call.countDocuments(filter);

    // Format response exactly like chat sessions
    const formattedCalls = calls.map((call) => ({
      _id: call._id,
      callId: call._id,
      callType: call.callType, // AUDIO or VIDEO
      direction: call.direction,
      status: call.status,
      user: call.userId,
      ratePerMinute: call.chargesPerMinute,
      totalAmount: call.totalAmount || 0,
      duration: call.duration || 0, // seconds
      connectTime: call.connectTime,
      startTime: call.startTime,
      endTime: call.endTime,
      userRating: call.rating,
      userFeedback: call.feedback,
      recordingUrl: call.recordingUrl,
      paymentStatus: call.paymentStatus || "PENDING",
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      data: formattedCalls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalCalls: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get astrologer call sessions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch call sessions",
      error: error.message,
    });
  }
};

export const getCallSessionDetails = asyncHandler(async (req, res) => {
  const { callId } = req.params; // Mongo _id (or you can change to custom callId if you add one)
  const userId = req.user.id;

  const call = await Call.findOne({
    _id: callId,
    $or: [{ userId }, { astrologerId: userId }],
  })
    .populate([
      { path: "userId", select: "fullName phone avatar gender" },
      { path: "astrologerId", select: "fullName phone avatar callRate" },
    ])
    .lean(); // optional: faster + cleaner

  if (!call) {
    throw new ApiError(404, "Call session not found or access denied");
  }

  // Optional: hide sensitive fields from the other party if needed
  // e.g. hide recordingUrl from user if policy says only astrologer can access
  // if (req.user.role === "user" && call.recordingUrl) {
  //     delete call.recordingUrl;
  // }

  return res
    .status(200)
    .json(
      new ApiResponse(200, call, "Call session details retrieved successfully")
    );
});

const startBillingTimer = async (
  sessionId,
  chatId,
  ratePerMinute,
  reservationId,
  estimatedMinutes = 10
) => {
  if (billingTimers.has(sessionId)) {
    console.log(`Billing already active for session: ${sessionId}`);
    return;
  }

  console.log(
    `Starting billing timer for session: ${sessionId}, Estimated: ${estimatedMinutes} mins`
  );

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
        status: { $in: ["ACTIVE", "PAUSED"] },
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
          lastActivityAt: new Date(),
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
        await Reservation.findByIdAndUpdate(reservationId, {
          $set: {
            totalCost: currentCost,
            billedMinutes: billedMinutes,
            totalDurationSec: updateResult.billedDuration,
            status: "ONGOING",
          },
        });
      }

      // Calculate time remaining
      const elapsedMs = billedMinutes * 60 * 1000;
      const remainingMs = Math.max(0, sessionDurationMs - elapsedMs);
      const minutesRemaining = Math.ceil(remainingMs / (60 * 1000));

      // Check if session needs to be auto-ended (if no time left)
      if (remainingMs <= 0) {
        console.log(
          `Session ${sessionId} time limit reached, triggering auto-end`
        );
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
      emitSocketEventGlobal(chatId, ChatEventsEnum.BILLING_UPDATE_EVENT, {
        sessionId,
        billedDuration: updateResult.billedDuration,
        billedMinutes: billedMinutes,
        currentCost,
        ratePerMinute,
        minutesRemaining,
        nextBillingIn: 60,
      });

      console.log(
        `Billed session ${sessionId}: ${updateResult.billedDuration}s, ${billedMinutes}m, ₹${currentCost}, ${minutesRemaining} min remaining`
      );
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
    ratePerMinute,
  });

  // Immediately send first billing update
  emitSocketEventGlobal(chatId, ChatEventsEnum.BILLING_UPDATE_EVENT, {
    sessionId,
    billedDuration: 0,
    billedMinutes: 0,
    currentCost: 0,
    ratePerMinute,
    minutesRemaining: estimatedMinutes,
    nextBillingIn: 60,
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

const setupSessionReminders = (sessionId, chatId, estimatedMinutes) => {
  // Clear any existing reminders
  clearReminders(sessionId);

  // Set reminders at 5, 2, and 1 minute marks
  const reminderTimes = [5, 2, 1];

  reminderTimes.forEach((minutes) => {
    if (estimatedMinutes > minutes) {
      const reminderTimeMs = (estimatedMinutes - minutes) * 60 * 1000;
      const timer = setTimeout(() => {
        sendSessionReminder(sessionId, chatId, minutes);
      }, reminderTimeMs);

      reminderTimers.set(`${sessionId}_${minutes}min`, timer);
    }
  });
};

const clearReminders = (sessionId) => {
  reminderTimers.forEach((timer, key) => {
    if (key.startsWith(sessionId)) {
      clearTimeout(timer);
      reminderTimers.delete(key);
    }
  });

  // Clear reminder sent flags
  ["5min", "2min", "1min"].forEach((min) => {
    reminderSent.delete(`${sessionId}_${min}`);
  });
};

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
    emitSocketEventGlobal(chatId, ChatEventsEnum.INSUFFICIENT_BALANCE_WARNING, {
      sessionId,
      status: "AUTO_ENDED",
      message: "Session auto-ended due to time limit",
    });

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

    emitSocketEventGlobal(chatId, ChatEventsEnum.RESERVATION_ENDING_SOON, {
      sessionId,
      minutesRemaining,
      message: `Your chat session will end in ${minutesRemaining} minute${
        minutesRemaining > 1 ? "s" : ""
      }.`,
    });

    console.log(
      `Sent ${minutesRemaining} min reminder for session: ${sessionId}`
    );
  } catch (error) {
    console.error(`Failed to send reminder:`, error);
  }
};
