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
export const requestCallSession = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;
  let reservation = null;

  try {
    session.startTransaction();

    const { astrologerId, callType = "AUDIO", userMessage } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullName || "User";
    const userAvatar = req.user.avatar || "";

    console.log("=== REQUEST CALL SESSION ===");
    console.log("Request from User ID:", userId);
    console.log("Requesting Astrologer ID:", astrologerId);
    console.log("Call type:", callType);

    // VALIDATIONS
    if (!astrologerId) throw new ApiError(400, "Astrologer ID is required");
    if (req.user.role === "astrologer") throw new ApiError(403, "Astrologers cannot request calls");
    if (astrologerId.toString() === userId.toString()) throw new ApiError(400, "Cannot call yourself");
    if (!["AUDIO", "VIDEO"].includes(callType.toUpperCase())) throw new ApiError(400, "Invalid call type");

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId);

    // CHECK ASTROLOGER
    const astrologer = await User.findOne({
      _id: astrologerObjectId,
      role: "astrologer",
      userStatus: "Active",
      isSuspend: false
    }).session(session).select("fullName avatar callRate isOnline");

    if (!astrologer) throw new ApiError(404, "Astrologer not found or inactive");

    const astroProfile = await Astrologer.findOne({ userId: astrologerObjectId }).session(session);
    if (!astroProfile) throw new ApiError(404, "Astrologer profile not completed");

    if (!astrologer.isOnline) throw new ApiError(400, "Astrologer is offline");

    const ratePerMinute = astroProfile.ratepermin || astrologer.callRate || 50;

    // CHECK EXISTING SESSIONS
    const existingSession = await CallSession.findOne({
      $or: [
        { userId, astrologerId: astrologerObjectId, status: { $in: ["REQUESTED", "RINGING", "CONNECTED", "ACTIVE"] } },
        { astrologerId: userId, status: { $in: ["REQUESTED", "RINGING", "CONNECTED", "ACTIVE"] } }
      ]
    }).session(session);

    if (existingSession) {
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, {
        sessionId: existingSession.sessionId,
        status: existingSession.status,
        message: `Existing ${existingSession.status.toLowerCase()} call`
      }, "Existing session found"));
    }

    // CHECK ASTROLOGER BUSY
    const astrologerBusy = await CallSession.findOne({
      astrologerId: astrologerObjectId,
      status: { $in: ["CONNECTED", "ACTIVE", "RINGING"] }
    }).session(session);

    if (astrologerBusy) throw new ApiError(400, "Astrologer is busy");

    // RESERVE BALANCE UPFRONT
    const estimatedMinutes = 10;
    const estimatedCost = ratePerMinute * estimatedMinutes;

    const balanceCheck = await WalletService.checkBalance({ userId, amount: estimatedCost, currency: "INR" });

    if (!balanceCheck.hasSufficientBalance) {
      throw new ApiError(402, "Insufficient balance", {
        required: estimatedCost,
        available: balanceCheck.availableBalance,
        shortfall: balanceCheck.shortfall
      });
    }

    const commissionDetails = await calculateCommission(
      astrologerObjectId,
      "CALL",
      estimatedCost,
      { callType: callType.toUpperCase(), estimatedMinutes }
    );

    reservation = await Reservation.create([{
      reservationId: generateTxId("RES"),
      userId,
      astrologerId: astrologerObjectId,
      sessionType: "CALL",
      callType: callType.toUpperCase(),
      ratePerMinute,
      currency: "INR",
      commissionPercent: commissionDetails.finalCommissionPercent,
      lockedAmount: estimatedCost,
      totalCost: estimatedCost, // Initial estimate
      platformEarnings: commissionDetails.platformAmount,
      astrologerEarnings: commissionDetails.astrologerAmount,
      status: "RESERVED",
      startAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
      commissionDetails,
      meta: { estimatedMinutes, reservationFor: "INITIAL_CALL" }
    }], { session });

    await WalletService.reserveAmount({
      userId,
      amount: estimatedCost,
      currency: "INR",
      reservationId: reservation[0]._id,
      sessionType: "CALL",
      description: `Reserved for ${callType.toLowerCase()} call (${estimatedMinutes} mins)`
    });

    // GENERATE IDs
    const requestId = CallRequest.generateRequestId();
    const sessionId = CallSession.generateSessionId();

    // CREATE CALL SESSION
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
      reservationId: reservation[0]._id,
      meta: { callerName: userName, callerImage: userAvatar, userMessage: userMessage?.trim() || "" }
    }], { session });

    // CREATE CALL REQUEST
    const callRequest = await CallRequest.create([{
      requestId,
      sessionId: callSession[0].sessionId,
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      userMessage: userMessage?.trim() || null,
      ratePerMinute,
      status: "PENDING",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 60 * 1000),
      reservationId: reservation[0]._id,
      meta: { callerName: userName, callerImage: userAvatar }
    }], { session });

    // CREATE CALL DOCUMENT
    const callDoc = await Call.create([{
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      direction: "USER_TO_ASTROLOGER",
      status: "INITIATED",
      chargesPerMinute: ratePerMinute,
      startTime: new Date(),
      reservationId: reservation[0]._id,
      meta: { requestId, sessionId: callSession[0].sessionId }
    }], { session });

    // LINK IDs
    await Promise.all([
      CallSession.findByIdAndUpdate(callSession[0]._id, { callId: callDoc[0]._id }, { session }),
      CallRequest.findByIdAndUpdate(callRequest[0]._id, { callId: callDoc[0]._id }, { session })
    ]);

    hasCommitted = true;
    await session.commitTransaction();

    // NOTIFY ASTROLOGER
    await notifyAstrologerAboutCallRequest(req, astrologerObjectId, {
      requestId,
      sessionId,
      callType: callType.toUpperCase(),
      callerId: userId,
      callerName: userName,
      callerImage: userAvatar,
      ratePerMinute,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000),
      message: userMessage || `${userName} wants to connect via ${callType.toLowerCase()} call`
    });

    // SET EXPIRY TIMER (with refund on expire)
    setCallRequestTimer(requestId, sessionId, astrologerObjectId, userId, reservation[0]._id);

    return res.status(201).json(
      new ApiResponse(201, {
        requestId,
        sessionId,
        callId: callDoc[0]._id.toString(),
        callType: callType.toUpperCase(),
        ratePerMinute,
        expiresAt: new Date(Date.now() + 3 * 60 * 1000),
        reservedMinutes: estimatedMinutes,
        reservedAmount: estimatedCost,
        status: "PENDING"
      }, "Call request sent successfully")
    );

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
    if (reservation) await WalletService.cancelReservation(reservation[0]._id).catch(console.error);
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
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { sessionId } = req.params;
    const userId = req.user._id;

    const callSession = await CallSession.findOne({ sessionId }).session(session);
    if (!callSession) throw new ApiError(404, "Call session not found");

    const call = await Call.findById(callSession.callId).session(session);
    if (!call) throw new ApiError(404, "Call record not found");

    if (call.userId.toString() !== userId.toString()) throw new ApiError(403, "Unauthorized");

    if (call.status !== "RINGING") {
      if (call.status === "CONNECTED" || call.status === "ACTIVE") {
        await session.abortTransaction();
        return res.status(200).json(new ApiResponse(200, { status: call.status }, "Call already connected"));
      }
      throw new ApiError(400, `Cannot start: status is ${call.status}`);
    }

    const now = new Date();

    // UPDATE TO CONNECTED
    call.status = "CONNECTED";
    call.connectTime = now;
    call.paymentStatus = "RESERVED";
    await call.save({ session });

    callSession.status = "CONNECTED";
    callSession.connectedAt = now;
    await callSession.save({ session });

    hasCommitted = true;
    await session.commitTransaction();

    // CLEAR RINGING TIMER
    clearCallTimer(sessionId, 'ringing');

    // START BILLING TIMER
    startBillingTimer(
      sessionId,
      call._id,
      call.userId,
      call.astrologerId,
      call.chargesPerMinute,
      callSession.reservationId,
      call.callType
    );

    // NOTIFY BOTH
    const payload = {
      sessionId,
      callId: call._id.toString(),
      status: "CONNECTED",
      connectTime: now,
      ratePerMinute: call.chargesPerMinute
    };

    emitSocketEvent(req, call.userId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);
    emitSocketEvent(req, call.astrologerId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);

    return res.status(200).json(new ApiResponse(200, payload, "Call connected"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
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

    if (!callSession) throw new ApiError(404, "Active call not found");

    const call = await Call.findById(callSession.callId).session(session);
    if (!call) throw new ApiError(404, "Call record not found");

    // STOP BILLING
    stopBillingTimer(sessionId);
    clearReminders(sessionId);
    if (autoEndTimers.has(sessionId)) {
      clearTimeout(autoEndTimers.get(sessionId));
      autoEndTimers.delete(sessionId);
    }

    const now = new Date();
    const connectedAt = callSession.connectedAt || now;
    const totalSeconds = Math.floor((now - connectedAt) / 1000);
    const billedMinutes = Math.ceil(totalSeconds / 60);
    const actualCost = Math.max(callSession.minimumCharge, billedMinutes * callSession.ratePerMinute);

    // UPDATE SESSION
    callSession.status = "COMPLETED";
    callSession.endedAt = now;
    callSession.totalDuration = totalSeconds;
    callSession.billedDuration = billedMinutes * 60;
    callSession.totalCost = actualCost;
    await callSession.save({ session });

    // UPDATE CALL
    call.status = "COMPLETED";
    call.endTime = now;
    call.duration = totalSeconds;
    call.totalAmount = actualCost;
    call.endedBy = userId;
    call.endedByRole = req.user.role;
    await call.save({ session });

    // UPDATE REQUEST
    await CallRequest.findOneAndUpdate({ sessionId }, { status: "COMPLETED" }, { session });

    // PROCESS PAYMENT (deduct actual, refund excess)
    if (callSession.reservationId) {
      const settlement = await WalletService.processSessionPayment(callSession.reservationId, {
        actualCost,
        actualMinutes: billedMinutes,
        totalDurationSec: totalSeconds
      });
      callSession.paymentStatus = "PAID";
      callSession.platformCommission = settlement.platformCommission || 0;
      callSession.astrologerEarnings = settlement.astrologerEarnings || 0;
      await callSession.save({ session });
    }

    hasCommitted = true;
    await session.commitTransaction();

    // NOTIFY
    const payload = {
      sessionId,
      callId: call._id.toString(),
      status: "COMPLETED",
      totalCost: actualCost,
      durationSeconds: totalSeconds,
      billedMinutes,
      endedAt: now
    };

    emitSocketEvent(req, callSession.userId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);
    emitSocketEvent(req, callSession.astrologerId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);

    return res.status(200).json(new ApiResponse(200, payload, "Call ended"));

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
