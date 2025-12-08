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
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallRequest } from "../../models/calllogs/callRequest.js";
import { CallSession } from "../../models/calllogs/callSession.js";
import { Astrologer } from "../../models/astrologer.js";
import logger from "../../utils/logger.js";
import admin from "../../utils/firabse.js";
const billingTimers = new Map();
const autoEndTimers = new Map();
const reminderTimers = new Map();
const reminderSent = new Map();
const activeCallTimers = new Map();

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
      receiverId: astrologerId,
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
    body: `${payload.callerName} is calling you (₹${payload.ratePerMinute}/min)`,
    type: "incoming_call",
    data: {
      screen: "IncomingCall", // Critical: Opens IncomingCall screen
      requestId: payload.requestId,
      sessionId: payload.sessionId,
      callType: payload.callType,
      callerId: payload.callerId,
      callerName: payload.callerName,
      callerImage: payload.callerImage,
      ratePerMinute: payload.ratePerMinute.toString(),
    },
  });
};

function generateTxId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Updated requestCallSession (with upfront reservation)
// === requestCallSession === REMOVE ALL RESERVATION & WALLET CODE ===
export const requestCallSession = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { astrologerId, callType = "AUDIO", userMessage } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullName || "User";
    const userAvatar = req.user.avatar || "";

    // VALIDATIONS (same as before)
    if (!astrologerId) throw new ApiError(400, "Astrologer ID is required");
    if (req.user.role === "astrologer") throw new ApiError(403, "Astrologers cannot request calls");
    if (astrologerId.toString() === userId.toString()) throw new ApiError(400, "Cannot call yourself");
    if (!["AUDIO", "VIDEO"].includes(callType.toUpperCase())) throw new ApiError(400, "Invalid call type");

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId);

    const astrologer = await User.findOne({
      _id: astrologerObjectId,
      role: "astrologer",
      userStatus: "Active",
      isSuspend: false
    }).session(session).select("fullName avatar callRate isOnline");

    if (!astrologer) throw new ApiError(404, "Astrologer not found or inactive");
    if (!astrologer.isOnline) throw new ApiError(400, "Astrologer is offline");

    const astroProfile = await Astrologer.findOne({ userId: astrologerObjectId }).session(session);
    if (!astroProfile) throw new ApiError(404, "Astrologer profile not completed");

    const ratePerMinute = astroProfile.ratepermin || astrologer.callRate || 50;

    // Check existing or busy (same)
    const existingSession = await CallSession.findOne({ /* same */ });
    if (existingSession) { /* return existing */ }

    const astrologerBusy = await CallSession.findOne({ /* busy check */ });
    if (astrologerBusy) throw new ApiError(400, "Astrologer is busy");

    // === NO BALANCE CHECK, NO RESERVATION HERE ===
    // Just create session documents

    const requestId = CallRequest.generateRequestId();
    const sessionId = CallSession.generateSessionId();

    const callSession = await CallSession.create([{
      sessionId,
      requestId,
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      ratePerMinute,
      status: "REQUESTED",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 60 * 1000),
      minimumCharge: Math.max(50, ratePerMinute),
      meta: { callerName: userName, callerImage: userAvatar, userMessage: userMessage?.trim() || "" }
    }], { session });

    await CallRequest.create([{
      requestId,
      sessionId,
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      ratePerMinute,
      status: "PENDING",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 60 * 1000),
      meta: { callerName: userName, callerImage: userAvatar }
    }], { session });

    const callDoc = await Call.create([{
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      direction: "USER_TO_ASTROLOGER",
      status: "INITIATED",
      chargesPerMinute: ratePerMinute,
      startTime: new Date(),
      meta: { requestId, sessionId }
    }], { session });

    await CallSession.findByIdAndUpdate(callSession[0]._id, { callId: callDoc[0]._id }, { session });

    hasCommitted = true;
    await session.commitTransaction();

    // Notify astrologer
    await notifyAstrologerAboutCallRequest(req, astrologerObjectId, {
      requestId,
      sessionId,
      callType: callType.toUpperCase(),
      callerId: userId,
      callerName: userName,
      callerImage: userAvatar,
      ratePerMinute,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000),
    });

    // Set expiry timer (no refund needed — nothing reserved)
    setCallRequestTimer(requestId, sessionId, astrologerObjectId, userId);

    return res.status(201).json(new ApiResponse(201, {
      requestId,
      sessionId,
      callType: callType.toUpperCase(),
      ratePerMinute,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000),
      status: "PENDING"
    }, "Call request sent"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Updated acceptCallSession (no balance check, just set RINGING)
export const acceptCallSession = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { requestId } = req.params;
    const astrologerId = req.user._id;

    if (req.user.role !== "astrologer") throw new ApiError(403, "Only astrologers can accept calls");

    const callRequest = await CallRequest.findOne({ requestId }).session(session);
    if (!callRequest) throw new ApiError(404, "Call request not found");

    if (callRequest.astrologerId.toString() !== astrologerId.toString()) throw new ApiError(403, "Unauthorized");

    if (callRequest.status !== "PENDING") throw new ApiError(400, `Cannot accept: status is ${callRequest.status}`);

    if (new Date() > callRequest.expiresAt) {
      callRequest.status = "EXPIRED";
      await callRequest.save({ session });
      throw new ApiError(410, "Call request expired");
    }

    const callSession = await CallSession.findOne({ sessionId: callRequest.sessionId }).session(session);
    if (!callSession) throw new ApiError(404, "Call session not found");

    const now = new Date();

    // UPDATE REQUEST
    callRequest.status = "ACCEPTED";
    callRequest.respondedAt = now;
    await callRequest.save({ session });

    // UPDATE SESSION
    callSession.status = "RINGING";
    callSession.acceptedAt = now;
    callSession.expiresAt = new Date(now.getTime() + 45 * 1000); // 45s ringing
    await callSession.save({ session });

    // UPDATE CALL
    const call = await Call.findById(callSession.callId).session(session);
    if (call) {
      call.status = "RINGING";
      await call.save({ session });
    }

    hasCommitted = true;
    await session.commitTransaction();

    // CLEAR REQUEST TIMER
    clearCallTimer(requestId, 'request');

    // START RINGING TIMER (with potential refund if missed)
    startRingingTimer(callSession.sessionId, callSession.callId, callSession.reservationId);

    // NOTIFY USER VIA SOCKET AND PUSH
    const payload = {
      requestId,
      sessionId: callSession.sessionId,
      callId: callSession.callId.toString(),
      callType: callRequest.callType,
      ratePerMinute: callRequest.ratePerMinute,
      acceptedAt: now,
      ringingExpiresAt: callSession.expiresAt
    };

    // emitSocketEvent(req, callRequest.userId.toString(), ChatEventsEnum.CALL_ACCEPTED_EVENT, payload);

    // await sendNotification({
    //   userId: callRequest.userId,
    //   title: "Call Accepted!",
    //   body: `${req.user.fullName} accepted your call`,
    //   type: "accept_call",
    //   data: {
    //     screen: "OngoingCall",
    //     requestId,
    //     sessionId: callSession.sessionId,
    //     callType: callRequest.callType,
    //     astrologerId: astrologerId.toString(),
    //     astrologerName: req.user.fullName
    //   }
    // });

    return res.status(200).json(new ApiResponse(200, payload, "Call accepted, ringing user"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Updated startCallSession (no balance check, start billing)
export const startCallSession = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const { sessionId } = req.params;
      const userId = req.user._id;

      const callSession = await CallSession.findOne({ sessionId }).session(session);
      if (!callSession) throw new ApiError(404, "Call session not found");
      if (callSession.userId.toString() !== userId.toString()) throw new ApiError(403, "Unauthorized");
      if (callSession.status !== "RINGING") {
        if (callSession.status === "CONNECTED") throw new ApiError(200, "Call already connected");
        throw new ApiError(400, `Invalid status: ${callSession.status}`);
      }

      const now = new Date();
      const ratePerMinute = callSession.ratePerMinute;

      // === RESERVE 10 MINUTES NOW (when call actually starts) ===
      const estimatedMinutes = 10;
      const estimatedCost = ratePerMinute * estimatedMinutes;

      const balanceCheck = await WalletService.checkBalance({
        userId,
        amount: estimatedCost,
        currency: "INR"
      });

      if (!balanceCheck.hasSufficientBalance) {
        throw new ApiError(402, "Insufficient balance to start call", {
          required: estimatedCost,
          available: balanceCheck.availableBalance
        });
      }

      const commissionDetails = await calculateCommission(
        callSession.astrologerId,
        "CALL",
        estimatedCost,
        { callType: callSession.callType }
      );

      // Create reservation
      const reservation = await Reservation.create([{
        reservationId: generateTxId("RES"),
        userId,
        astrologerId: callSession.astrologerId,
        sessionType: "CALL",
        callType: callSession.callType,
        ratePerMinute,
        lockedAmount: estimatedCost,
        totalCost: estimatedCost,
        platformEarnings: commissionDetails.platformAmount,
        astrologerEarnings: commissionDetails.astrologerAmount,
        commissionPercent: commissionDetails.finalCommissionPercent,
        status: "RESERVED",
        startAt: now,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        commissionDetails,
        meta: { estimatedMinutes }
      }], { session });

      // Lock money
      await WalletService.reserveAmount({
        userId,
        amount: estimatedCost,
        reservationId: reservation[0]._id,
        sessionType: "CALL",
        description: `Reserved for ${callSession.callType} call (10 mins)`,
        session
      });

      // Update session
      callSession.status = "CONNECTED";
      callSession.connectedAt = now;
      callSession.reservationId = reservation[0]._id;
      await callSession.save({ session });

      const call = await Call.findById(callSession.callId).session(session);
      if (call) {
        call.connectTime = now;
        call.status = "CONNECTED";
        call.reservationId = reservation[0]._id;
        await call.save({ session });
      }
    });

    // === AFTER COMMIT: Start real billing ===
    const callSession = await CallSession.findOne({ sessionId: req.params.sessionId });
    const reservation = await Reservation.findById(callSession.reservationId);

    // Mark reservation as ONGOING
    await Reservation.findByIdAndUpdate(callSession.reservationId, {
      status: "ONGOING",
      startAt: new Date()
    });

    // Clear ringing timer
    clearCallTimer(sessionId, "ringing");

    // === START REAL-TIME BILLING ===
    startBillingTimer(
      sessionId,
      callSession.callId,
      callSession.userId,
      callSession.astrologerId,
      callSession.ratePerMinute,
      callSession.reservationId,
      callSession.callType
    );

    const payload = {
      sessionId,
      callId: callSession.callId.toString(),
      status: "CONNECTED",
      ratePerMinute: callSession.ratePerMinute,
      connectTime: new Date()
    };

    emitSocketEvent(req, callSession.userId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);
    emitSocketEvent(req, callSession.astrologerId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);

    return res.status(200).json(new ApiResponse(200, payload, "Call connected & billing started"));

  } catch (error) {
    if (error.statusCode === 200) {
      // Already connected
      return res.status(200).json(new ApiResponse(200, {}, "Call already connected"));
    }
    throw error;
  } finally {
    session.endSession();
  }
});
// Updated endCall (deduct actual, refund excess)
export const endCall = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { sessionId } = req.params;
    const userId = req.user._id;

    const callSession = await CallSession.findOne({
      sessionId,
      $or: [{ userId }, { astrologerId: userId }],
      status: { $in: ["CONNECTED", "ACTIVE"] }
    }).session(session);

    if (!callSession) {
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, {}, "Call already ended"));
    }

    const now = new Date();
    const connectedAt = callSession.connectedAt || now;
    const totalSeconds = Math.floor((now - connectedAt) / 1000);
    const billedMinutes = Math.ceil(totalSeconds / 60);
    const finalCost = Math.max(callSession.minimumCharge || 0, billedMinutes * callSession.ratePerMinute);

    // Stop billing timer
    stopBillingTimer(sessionId);
    clearReminders(sessionId);

    // Update session & call
    callSession.status = "COMPLETED";
    callSession.endedAt = now;
    callSession.totalDuration = totalSeconds;
    callSession.billedDuration = billedMinutes * 60;
    callSession.totalCost = finalCost;
    await callSession.save({ session });

    const call = await Call.findById(callSession.callId).session(session);
    if (call) {
      call.status = "COMPLETED";
      call.endTime = now;
      call.duration = totalSeconds;
      call.totalAmount = finalCost;
      call.endedBy = userId;
      await call.save({ session });
    }

    // FINAL REFUND OF UNUSED RESERVED AMOUNT
    if (callSession.reservationId) {
      const reservation = await Reservation.findById(callSession.reservationId).session(session);
      if (reservation) {
        const reservedAmount = reservation.lockedAmount || 0;
        const usedAmount = reservation.totalCost || finalCost;
        const refundAmount = reservedAmount - usedAmount;

        if (refundAmount > 0) {
          await WalletService.releaseAmount({
            userId,
            amount: refundAmount,
            currency: "INR",
            reservationId: reservation._id,
            description: "Call ended - refunding unused reserved amount",
            session
          });

          console.log(`[REFUND] ₹${refundAmount} refunded | Used: ₹${usedAmount} | Reserved: ₹${reservedAmount}`);
        }

        // Mark as settled
        reservation.status = "SETTLED";
        reservation.settledAt = now;
        reservation.refundedAmount = refundAmount;
        await reservation.save({ session });
      }
    }

    hasCommitted = true;
    await session.commitTransaction();

    // Notify both
    const payload = {
      sessionId,
      status: "COMPLETED",
      totalCost: finalCost,
      durationSeconds: totalSeconds,
      billedMinutes,
      endedAt: now
    };

    emitSocketEvent(req, callSession.userId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);
    emitSocketEvent(req, callSession.astrologerId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);

    return res.status(200).json(new ApiResponse(200, payload, "Call ended & refund processed"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});
// Updated rejectCall (full refund)
export const rejectCall = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { requestId } = req.params;
    const astrologerId = req.user._id;

    if (req.user.role !== "astrologer") throw new ApiError(403, "Only astrologers can reject calls");

    const callRequest = await CallRequest.findOne({ requestId, astrologerId, status: "PENDING" }).session(session);
    if (!callRequest) throw new ApiError(404, "Call request not found or not pending");

    const now = new Date();

    // UPDATE REQUEST
    callRequest.status = "REJECTED";
    callRequest.respondedAt = now;
    await callRequest.save({ session });

    // UPDATE SESSION
    const callSession = await CallSession.findOneAndUpdate(
      { sessionId: callRequest.sessionId },
      { status: "REJECTED", endedAt: now },
      { session, new: true }
    );

    // UPDATE CALL
    await Call.findByIdAndUpdate(callSession.callId, { status: "REJECTED", endTime: now }, { session });

    // FULL REFUND
    if (callRequest.reservationId) {
      await WalletService.cancelReservation(callRequest.reservationId);
      callSession.paymentStatus = "REFUNDED";
      await callSession.save({ session });
    }

    hasCommitted = true;
    await session.commitTransaction();

    // CLEAR TIMER
    clearCallTimer(requestId, 'request');

    // NOTIFY USER
    emitSocketEvent(req, callRequest.userId.toString(), ChatEventsEnum.CALL_REJECTED_EVENT, {
      requestId,
      sessionId: callRequest.sessionId,
      rejectedAt: now,
      message: "Call rejected by astrologer"
    });

    return res.status(200).json(new ApiResponse(200, { requestId, status: "REJECTED" }, "Call rejected"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Updated cancelCallRequest (full refund if before accept)
export const cancelCallRequest = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { requestId } = req.params;
    const userId = req.user._id;

    const callRequest = await CallRequest.findOne({ requestId, userId, status: "PENDING" }).session(session);
    if (!callRequest) throw new ApiError(404, "Call request not found or not pending");

    const now = new Date();

    // UPDATE REQUEST
    callRequest.status = "CANCELLED";
    callRequest.respondedAt = now;
    await callRequest.save({ session });

    // UPDATE SESSION
    const callSession = await CallSession.findOneAndUpdate(
      { sessionId: callRequest.sessionId },
      { status: "CANCELLED", endedAt: now },
      { session, new: true }
    );

    // UPDATE CALL
    await Call.findByIdAndUpdate(callSession.callId, { status: "CANCELLED", endTime: now }, { session });

    // FULL REFUND
    if (callRequest.reservationId) {
      await WalletService.cancelReservation(callRequest.reservationId);
      callSession.paymentStatus = "REFUNDED";
      await callSession.save({ session });
    }

    hasCommitted = true;
    await session.commitTransaction();

    // CLEAR TIMER
    clearCallTimer(requestId, 'request');

    // NOTIFY ASTROLOGER
    emitSocketEvent(req, callRequest.astrologerId.toString(), ChatEventsEnum.CALL_CANCELLED, {
      requestId,
      sessionId: callRequest.sessionId,
      cancelledAt: now
    });

    return res.status(200).json(new ApiResponse(200, { requestId, status: "CANCELLED" }, "Call cancelled"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
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
      limit = 100,
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
    const callSession = await CallSession.find(filter)
      .populate("userId", "fullName avatar phone gender email")
      .sort(sortOptions)

      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // faster + easier to manipulate

    const total = await CallSession.countDocuments(filter);

    // Format response exactly like chat sessions
    const formattedCalls = callSession.map((call) => ({
      _id: call._id,
      callId: call._id,
      requestId: call.requestId,
      sessionId: call.sessionId, // AUDIO or VIDEO
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
  const userId = req.user._id;

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

// ─────────────────────── CALL BILLING TIMER (NOT CHAT) ───────────────────────


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



// ─────────────────────── FINAL CALL BILLING TIMER (100% CORRECT) ───────────────────────
const startBillingTimer = async (
  sessionId,
  callId,
  userId,
  astrologerId,
  ratePerMinute,
  reservationId,
  callType
) => {
  if (billingTimers.has(sessionId)) {
    console.log(`[BILLING] Already running for ${sessionId}`);
    return;
  }

  console.log(`[BILLING] Starting REAL-TIME billing for ${sessionId} | ₹${ratePerMinute}/min`);

  stopBillingTimer(sessionId); // cleanup

  let billedMinutes = 0;
  const startTime = Date.now();

  // PER-MINUTE REAL DEDUCTION + UPDATE
  const interval = setInterval(async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const callSession = await CallSession.findOne({
          sessionId,
          status: { $in: ["CONNECTED", "ACTIVE"] }
        }).session(session);

        if (!callSession) {
          console.log(`[BILLING] Call ended. Stopping timer.`);
          stopBillingTimer(sessionId);
          return;
        }

        billedMinutes++;
        const totalSeconds = billedMinutes * 60;
        const currentCost = Math.max(callSession.minimumCharge || ratePerMinute, billedMinutes * ratePerMinute);

        // 1. Update CallSession
        await CallSession.updateOne(
          { _id: callSession._id },
          {
            $set: {
              status: "ACTIVE",
              billedDuration: totalSeconds,
              totalCost: currentCost,
              lastActivityAt: new Date()
            }
          }
        ).session(session);

        // 2. CRITICAL: Deduct from RESERVED → USED (release + debit)
        if (reservationId) {
          const reservation = await Reservation.findById(reservationId).session(session);
          if (!reservation) throw new Error("Reservation not found");

          const alreadyUsed = reservation.totalCost || 0;
          const thisMinuteCost = ratePerMinute;
          const newTotalCost = alreadyUsed + thisMinuteCost;

          // Release from locked → available
          await WalletService.releaseAmount({
            userId,
            amount: thisMinuteCost,
            currency: "INR",
            reservationId: reservation._id,
            description: `Call minute ${billedMinutes} - ₹${ratePerMinute}`,
            session
          });

          // Immediately debit from available (real deduction)
          await WalletService.debit({
            userId,
            amount: thisMinuteCost,
            currency: "INR",
            category: "CALL_SESSION",
            subcategory: callType,
            description: `Call with astrologer - minute ${billedMinutes}`,
            reservationId: reservation._id,
            session
          });

          // Update reservation
          await Reservation.findByIdAndUpdate(reservationId, {
            $set: {
              totalCost: newTotalCost,
              billedMinutes,
              totalDurationSec: totalSeconds,
              status: "ONGOING"
            }
          }, { session });
        }

        // 3. Emit real-time update
        const remainingMins = Math.max(0, 10 - billedMinutes); // assuming 10 min reserve
        emitSocketEventGlobal(callId.toString(), ChatEventsEnum.BILLING_UPDATE_EVENT, {
          sessionId,
          billedMinutes,
          currentCost,
          ratePerMinute,
          minutesRemaining: remainingMins > 0 ? remainingMins : 0,
          message: remainingMins <= 2 ? `Only ${remainingMins} min left!` : undefined
        });

        // 4. Low balance warning (check live balance)
        const balance = await WalletService.getBalance(userId);
        if ((balance.available + balance.bonus) < ratePerMinute * 2) {
          emitSocketEventGlobal(callId.toString(), ChatEventsEnum.LOW_BALANCE_WARNING, {
            sessionId,
            message: "Low balance! Call will end soon.",
            remainingBalance: balance.available + balance.bonus
          });

          // Auto-end in 60 seconds
          setTimeout(() => handleCallAutoEnd(sessionId, callId, reservationId), 60000);
        }

      }); // end transaction
    } catch (err) {
      console.error(`[BILLING ERROR] Minute ${billedMinutes} failed:`, err.message);
      // Do NOT stop timer — keep trying next minute
    } finally {
      session.endSession();
    }
  }, 60_000);

  // Store timer
  billingTimers.set(sessionId, { interval, startTime: Date.now() });

  // Initial emit
  emitSocketEventGlobal(callId.toString(), ChatEventsEnum.BILLING_UPDATE_EVENT, {
    sessionId,
    billedMinutes: 0,
    currentCost: 0,
    ratePerMinute,
    minutesRemaining: 10,
  });

  console.log(`[BILLING] Timer started for ${sessionId}`);
};

// ─────────────────────── STOP BILLING SAFELY ───────────────────────
const stopBillingTimer = (sessionId) => {
  const data = billingTimers.get(sessionId);
  if (data) {
    clearInterval(data.interval);
    billingTimers.delete(sessionId);
    console.log(`[CALL] Billing stopped for ${sessionId}`);
  }

  // Also clear auto-end & reminders
  if (autoEndTimers.has(sessionId)) {
    clearTimeout(autoEndTimers.get(sessionId));
    autoEndTimers.delete(sessionId);
  }
  clearReminders(sessionId);
};

// ─────────────────────── CLEAR ALL REMINDERS ───────────────────────
const clearReminders = (sessionId) => {
  reminderTimers.forEach((timer, key) => {
    if (key.startsWith(sessionId)) {
      clearTimeout(timer);
      reminderTimers.delete(key);
    }
  });
  ["5min", "2min", "1min"].forEach(m => reminderSent.delete(`${sessionId}_${m}`));
};

// ─────────────────────── AUTO END CALL (LOW BALANCE / TIME UP) ───────────────────────
const handleCallAutoEnd = async (sessionId, callId, reservationId) => {
  console.log(`[CALL] Auto-ending call ${sessionId} due to time limit`);
  stopBillingTimer(sessionId);

  try {
    // Trigger endCall logic via API (safest way)
    const dummyReq = { params: { sessionId }, user: { _id: "auto-end" } };
    const dummyRes = {
      status: () => ({ json: () => { } }),
      json: () => { }
    };
    await endCall(dummyReq, dummyRes);
  } catch (err) {
    console.error("Auto-end failed:", err);
  }
};

// ─────────────────────── REMINDER NOTIFICATION ───────────────────────
const sendCallReminder = async (sessionId, minutes) => {
  if (reminderSent.has(`${sessionId}_${minutes}min`)) return;
  reminderSent.set(`${sessionId}_${minutes}min or true`);

  const callSession = await CallSession.findOne({ sessionId })
    .populate("userId", "fullName")
    .populate("astrologerId", "fullName");

  if (!callSession) return;

  emitSocketEventGlobal(callSession.callId?.toString(), ChatEventsEnum.RESERVATION_ENDING_SOON, {
    sessionId,
    minutesRemaining: minutes,
    message: `Your call will end in ${minutes} minute${minutes > 1 ? 's' : ''} due to low balance`,
  });
};
const startRingingTimer = (sessionId, callId, reservationId) => {
  const timer = setTimeout(async () => {
    const mongoSession = await mongoose.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const callSession = await CallSession.findOne({
          sessionId,
          status: "RINGING"
        }).session(mongoSession);

        if (!callSession) return;

        await Promise.all([
          CallSession.findByIdAndUpdate(callSession._id, {
            status: "MISSED",
            endedAt: new Date(),
            paymentStatus: "REFUNDED"
          }, { session: mongoSession }),

          Call.findByIdAndUpdate(callId, {
            status: "MISSED",
            endTime: new Date()
          }, { session: mongoSession }),

          CallRequest.findOneAndUpdate({ sessionId }, { status: "MISSED" }, { session: mongoSession })
        ]);

        // 100% REFUND – USER DIDN'T ANSWER
        if (reservationId) {
          await WalletService.cancelReservation(reservationId);
          console.log(`100% refunded – call missed: ${reservationId}`);
        }

        emitSocketEventGlobal(callSession.userId.toString(), ChatEventsEnum.CALL_MISSED_EVENT, {
          sessionId, message: "You missed the call – amount refunded"
        });
        emitSocketEventGlobal(callSession.astrologerId.toString(), ChatEventsEnum.CALL_MISSED_EVENT, {
          sessionId, message: "User didn't answer"
        });
      });
    } catch (error) {
      console.error("Missed call refund failed:", error);
    } finally {
      mongoSession.endSession();
    }
  }, 45 * 1000);

  activeCallTimers.set(`ringing_${sessionId}`, timer);
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
      message: `Your chat session will end in ${minutesRemaining} minute${minutesRemaining > 1 ? "s" : ""
        }.`,
    });

    console.log(
      `Sent ${minutesRemaining} min reminder for session: ${sessionId}`
    );
  } catch (error) {
    console.error(`Failed to send reminder:`, error);
  }
};

const setCallRequestTimer = (requestId, sessionId, astrologerId, userId, reservationId) => {
  const timer = setTimeout(async () => {
    const mongoSession = await mongoose.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const callRequest = await CallRequest.findOne({
          requestId,
          status: "PENDING"
        }).session(mongoSession);

        if (!callRequest) return; // already handled

        // Mark everything as EXPIRED
        await Promise.all([
          CallRequest.findByIdAndUpdate(callRequest._id, {
            status: "EXPIRED",
            respondedAt: new Date()
          }, { session: mongoSession }),

          CallSession.findOneAndUpdate({ sessionId }, {
            status: "EXPIRED",
            endedAt: new Date(),
            paymentStatus: "REFUNDED"
          }, { session: mongoSession }),

          Call.findOneAndUpdate({ "meta.requestId": requestId }, {
            status: "EXPIRED",
            endTime: new Date()
          }, { session: mongoSession })
        ]);

        // 100% REFUND
        if (reservationId) {
          await WalletService.cancelReservation(reservationId);
          console.log(`100% refunded on expiry: ${reservationId}`);
        }

        // Notify both
        emitSocketEventGlobal(userId.toString(), ChatEventsEnum.CALL_EXPIRED_EVENT, {
          requestId, sessionId, message: "Call request expired – amount refunded"
        });
        emitSocketEventGlobal(astrologerId.toString(), ChatEventsEnum.CALL_EXPIRED_EVENT, {
          requestId, sessionId, message: "Call request expired"
        });
      });
    } catch (error) {
      console.error("Expiry refund failed:", error);
    } finally {
      mongoSession.endSession();
    }
  }, 3 * 60 * 1000); // 3 minutes

  activeCallTimers.set(`request_${requestId}`, timer);
};

const clearCallRequestTimer = (requestId) => {
  const timerKey = `request_${requestId}`;
  const timer = activeCallTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    activeCallTimers.delete(timerKey);
  }
};


const clearCallTimer = (id, type = 'request') => {
  const timerKey = `${type}_${id}`;
  const timer = activeCallTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    activeCallTimers.delete(timerKey);
    console.log(`Cleared ${type} timer for: ${id}`);
  }
};




const sendNotification = async ({
  userId,
  title,
  body,
  type = "call",
  data = {},
}) => {
  try {
    const user = await User.findById(userId).select("deviceToken fullName");
    if (!user || !user.deviceToken) {
      console.log(`No device token for user ${userId}`);
      return;
    }

    const defaultData = {
      screen: type === "incoming_call" ? "IncomingCall" : "OngoingCall",
      type,
      ...data,
    };

    const message = {
      token: user.deviceToken,
      notification: {
        title,
        body,
      },
      data: Object.keys(defaultData).reduce((acc, key) => {
        acc[key] = String(defaultData[key]);
        return acc;
      }, {}),
      android: {
        priority: "high",
        notification: {
          channelId: "call_notifications", // Must match Android channel
          sound: "default",
          vibrate: true,
          priority: "high",
          visibility: "public",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            "content-available": 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    logger.info(`Push sent to ${user.fullName || userId}: ${response}`);
    console.log("Notification sent:", response);
  } catch (error) {
    logger.error("FCM Notification failed:", error.message);
    console.error("Push notification error:", error);
  }
};
