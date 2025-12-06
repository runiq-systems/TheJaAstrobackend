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
import { Astrologer } from "../../models/astrologer.js";
import logger from "../../utils/logger.js";
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
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { astrologerId, callType = "AUDIO", userMessage } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullName || "User";
    const userAvatar = req.user.avatar || "";

    console.log("=== REQUEST CALL SESSION ===");
    console.log("Request from User ID:", userId);
    console.log("Requesting Astrologer ID:", astrologerId);
    console.log("Request User Role:", req.user.role);
    console.log("Call type:", callType);
    console.log("=== REQUEST CALL SESSION ===");


    // ========== VALIDATIONS ==========
    if (!astrologerId) {
      throw new ApiError(400, "Astrologer ID is required");
    }

    // Ensure user is not an astrologer
    if (req.user.role === "astrologer") {
      throw new ApiError(403, "Astrologers cannot request calls. Please use the astrologer app.");
    }

    // Check if trying to call self
    if (astrologerId.toString() === userId.toString()) {
      throw new ApiError(400, "Cannot call yourself");
    }

    if (!["AUDIO", "VIDEO"].includes(callType.toUpperCase())) {
      throw new ApiError(400, "Invalid call type. Must be AUDIO or VIDEO");
    }

    // Convert astrologerId to ObjectId
    let astrologerObjectId;
    try {
      astrologerObjectId = new mongoose.Types.ObjectId(astrologerId);
    } catch (error) {
      throw new ApiError(400, "Invalid astrologer ID format");
    }

    console.log("Astrologer ObjectId:", astrologerObjectId);

    // ========== CHECK ASTROLOGER AVAILABILITY ==========
    const astrologer = await User.findOne({
      _id: astrologerObjectId,
      role: "astrologer",
      userStatus: "Active",
      isSuspend: false
    })
      .session(session)
      .select("fullName avatar callRate isOnline");

    if (!astrologer) {
      throw new ApiError(404, "Astrologer not found or inactive");
    }

    console.log("Found astrologer:", astrologer.fullName);

    // Check astrologer profile
    const astroProfile = await Astrologer.findOne({
      userId: astrologerObjectId
    }).session(session);

    if (!astroProfile) {
      throw new ApiError(404, "Astrologer profile not completed");
    }

    // Check if astrologer is online
    if (!astrologer.isOnline) {
      throw new ApiError(400, "Astrologer is currently offline. Please try again when they're online.");
    }

    const ratePerMinute = astroProfile.ratepermin || astrologer.callRate || 50;
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes

    console.log("Rate:", ratePerMinute, "Expires:", expiresAt);

    // ========== CHECK FOR EXISTING ACTIVE SESSIONS ==========
    const existingSession = await CallSession.findOne({
      $or: [
        { userId, astrologerId: astrologerObjectId, status: { $in: ["REQUESTED", "RINGING", "CONNECTED", "ACTIVE", "ACCEPTED"] } },
        { astrologerId: userId, status: { $in: ["REQUESTED", "RINGING", "CONNECTED", "ACTIVE", "ACCEPTED"] } }
      ]
    }).session(session);

    if (existingSession) {
      // Return existing session info
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, {
        requestId: existingSession.requestId,
        sessionId: existingSession.sessionId,
        callType: existingSession.callType,
        ratePerMinute: existingSession.ratePerMinute,
        expiresAt: existingSession.expiresAt || expiresAt,
        status: existingSession.status,
        message: existingSession.status === "REQUESTED"
          ? "Call request already sent. Waiting for astrologer response."
          : `You already have a ${existingSession.status.toLowerCase()} call with this astrologer`
      }, "Existing session found"));
    }

    // ========== CHECK IF ASTROLOGER IS BUSY ==========
    const astrologerBusy = await CallSession.findOne({
      astrologerId: astrologerObjectId,
      status: { $in: ["CONNECTED", "ACTIVE", "RINGING"] }
    }).session(session);

    if (astrologerBusy) {
      throw new ApiError(400, `Astrologer is currently on a ${astrologerBusy.status.toLowerCase()} call. Please try again later.`);
    }

    // ========== GENERATE IDs ==========
    const requestId = CallRequest.generateRequestId();
    const sessionId = CallSession.generateSessionId();

    console.log("Generated - Request:", requestId, "Session:", sessionId);

    // ========== CREATE CALL SESSION ==========
    const callSession = await CallSession.create([{
      sessionId,
      requestId,
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      ratePerMinute,
      status: "REQUESTED",
      requestedAt: new Date(),
      expiresAt,
      minimumCharge: Math.max(50, ratePerMinute), // At least 1 minute charge
      meta: {
        requestId,
        callerName: userName,
        callerImage: userAvatar,
        userMessage: userMessage?.trim() || "",
        platform: req.headers['user-agent'] || "unknown"
      }
    }], { session });

    console.log("Call Session created:", callSession[0].sessionId);

    // ========== CREATE CALL REQUEST ==========
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
      expiresAt,
      meta: {
        callerName: userName,
        callerImage: userAvatar,
        sessionId: callSession[0].sessionId,
        deviceInfo: req.headers['user-agent'] || "unknown"
      }
    }], { session });

    console.log("Call Request created:", callRequest[0].requestId);
    const callId = ""

    // ========== CREATE CALL DOCUMENT (Optional - fix enum issue) ==========
    try {
      const callDoc = await Call.create([{
        userId,
        astrologerId: astrologerObjectId,
        callType: callType.toUpperCase(),
        direction: "USER_TO_ASTROLOGER",
        status: "INITIATED", // Use INITIATED instead of REQUESTED if that's in your enum
        chargesPerMinute: ratePerMinute,
        startTime: new Date(),
        meta: {
          requestId: callRequest[0].requestId,
          sessionId: callSession[0].sessionId,
          initialRequest: true
        }
      }], { session });
      callId = callDoc[0]._id;


      // Link documents
      await Promise.all([
        CallSession.findByIdAndUpdate(
          callSession[0]._id,
          { callId: callDoc[0]._id },
          { session }
        ),
        CallRequest.findByIdAndUpdate(
          callRequest[0]._id,
          { callId: callDoc[0]._id },
          { session }
        )
      ]);

      console.log("Call Document created:", callDoc[0]._id);
    } catch (callError) {
      console.warn("Call document creation skipped:", callError.message);
      // Continue without call document - it's optional for now
    }



    hasCommitted = true;
    await session.commitTransaction();

    console.log("✅ Transaction committed");

    // ========== NOTIFY ASTROLOGER ==========
    try {
      await notifyAstrologerAboutCallRequest(req, astrologerObjectId, {
        requestId,
        sessionId,
        callType: callType.toUpperCase(),
        callId: callId.toString(),  // THIS IS CRITICAL
        callRecordId: callId.toString(),
        callerId: userId,
        callerName: userName,
        callerImage: userAvatar,
        ratePerMinute,
        expiresAt,
        message: userMessage?.trim() || `${userName} wants to connect via ${callType.toLowerCase()} call`
      });
      console.log("✅ Astrologer notified via socket");
    } catch (socketError) {
      console.error("Socket notification failed:", socketError.message);
    }

    // ========== SET EXPIRY TIMER ==========
    setCallRequestTimer(requestId, sessionId, astrologerObjectId, userId);

    // ========== RETURN SUCCESS ==========
    return res.status(201).json(
      new ApiResponse(
        201,
        {
          requestId,
          sessionId,
          callId: callId.toString(),  // THIS IS CRITICAL
  callRecordId: callId.toString(),
          callType: callType.toUpperCase(),
          ratePerMinute,
          expiresAt,
          status: "PENDING",
          timeRemainingSeconds: Math.floor((expiresAt - new Date()) / 1000),
          astrologerInfo: {
            id: astrologerObjectId,
            fullName: astrologer.fullName,
            avatar: astrologer.avatar,
            isOnline: astrologer.isOnline
          },
          timestamps: {
            requestedAt: new Date(),
            expiresAt: expiresAt
          }
        },
        "Call request sent successfully! Astrologer has 3 minutes to accept."
      )
    );

  } catch (error) {
    console.error("❌ Error in requestCallSession:", {
      message: error.message,
      code: error.code,
      name: error.name
    });

    if (!hasCommitted && session.inTransaction()) {
      await session.abortTransaction();
      console.log("Transaction aborted");
    }

    throw error;
  } finally {
    session.endSession();
  }
});

export const startCallSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params; // callId is the Mongo _id from requestCallSession
  const userId = req.user.id; // this is the USER (caller)

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
 

    // Find the call (must be in RINGING or CONNECTED state)
// Find CallSession
    const callSession = await CallSession.findOne({ sessionId }).session(session);
    if (!callSession) throw new ApiError(404, "Call session not found");

    // Find linked Call document
    const call = await Call.findById(callSession.callId).session(session);
    if (!call) throw new ApiError(404, "Call record not found");

    if (call.userId.toString() !== userId.toString()) {
      throw new ApiError(403, "Unauthorized to start this call");
    }

    if (call.status !== "RINGING") {
      if (call.status === "CONNECTED") {
        return res.status(200).json(new ApiResponse(200, { status: "CONNECTED" }));
      }
      throw new ApiError(400, `Call is ${call.status}, cannot start`);
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
    call.status = "CONNECTED";
    call.connectTime = new Date();
    call.paymentStatus = "RESERVED";
    call.reservationId = reservation[0]._id;
    await call.save({ session });

    await session.commitTransaction();
 

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
      callId: call._id.toString(),
      sessionId: callSession.sessionId,
      callRecordId: call._id.toString(),
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

export const acceptCallSession = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { requestId } = req.params;
    const astrologerId = req.user._id; // This should be 68fa7bc46d095190ea7269bb from JWT

    console.log("=== ACCEPT CALL SESSION ===");
    console.log("Astrologer accepting call - ID:", astrologerId);
    console.log("Astrologer role:", req.user.role);
    console.log("Request ID to accept:", requestId);

    // ========== VERIFY ASTROLOGER ==========
    if (req.user.role !== "astrologer") {
      throw new ApiError(403, "Only astrologers can accept calls");
    }

    // ========== FIND CALL REQUEST ==========
    const callRequest = await CallRequest.findOne({
      requestId: requestId.trim()
    }).session(session);

    console.log("Call Request found:", {
      exists: !!callRequest,
      requestId: callRequest?.requestId,
      astrologerId: callRequest?.astrologerId,
      userId: callRequest?.userId,
      status: callRequest?.status
    });

    if (!callRequest) {
      throw new ApiError(404, `Call request "${requestId}" not found. It may have expired or been cancelled.`);
    }

    // ========== VERIFY ASTROLOGER AUTHORIZATION ==========
    const requestAstrologerId = callRequest.astrologerId.toString();
    const acceptingAstrologerId = astrologerId.toString();

    console.log("ID Comparison:", {
      requestAstrologerId,
      acceptingAstrologerId,
      match: requestAstrologerId === acceptingAstrologerId
    });

    if (requestAstrologerId !== acceptingAstrologerId) {
      throw new ApiError(403,
        `Unauthorized. This call request is for astrologer ID: ${requestAstrologerId}, 
        but your ID is: ${acceptingAstrologerId}`
      );
    }

    // ========== CHECK REQUEST STATUS ==========
    if (callRequest.status !== "PENDING") {
      throw new ApiError(400,
        `Cannot accept call. Current status is: ${callRequest.status}. 
        ${callRequest.status === "EXPIRED" ? "The request has expired." : ""}
        ${callRequest.status === "CANCELLED" ? "The request was cancelled." : ""}
        ${callRequest.status === "ACCEPTED" ? "Already accepted." : ""}`
      );
    }

    // ========== CHECK EXPIRATION ==========
    if (callRequest.isExpired()) {
      await CallRequest.findByIdAndUpdate(
        callRequest._id,
        {
          status: "EXPIRED",
          respondedAt: new Date()
        },
        { session }
      );

      // Update session too
      if (callRequest.sessionId) {
        await CallSession.findOneAndUpdate(
          { sessionId: callRequest.sessionId },
          {
            status: "EXPIRED",
            endedAt: new Date()
          },
          { session }
        );
      }

      throw new ApiError(410, "Call request has expired. Please ask the user to call again.");
    }

    // ========== FIND CALL SESSION ==========
    const callSession = await CallSession.findOne({
      sessionId: callRequest.sessionId
    }).session(session);

    if (!callSession) {
      throw new ApiError(404, "Call session not found. The request may be corrupted.");
    }

    console.log("Call Session found:", {
      sessionId: callSession.sessionId,
      currentStatus: callSession.status
    });

    // ========== UPDATE REQUEST AND SESSION ==========
    const now = new Date();

    // Update Call Request
    await CallRequest.findByIdAndUpdate(
      callRequest._id,
      {
        status: "ACCEPTED",
        respondedAt: now
      },
      { session }
    );

    // Update Call Session
    await CallSession.findByIdAndUpdate(
      callSession._id,
      {
        status: "RINGING",
        acceptedAt: now,
        ringingAt: now,
        expiresAt: new Date(Date.now() + 45 * 1000) // 45 seconds for user to answer
      },
      { session }
    );

    // ========== UPDATE OR CREATE CALL DOCUMENT ==========
    let callDocument;
    if (callSession.callId) {
      // Update existing call
      await Call.findByIdAndUpdate(
        callSession.callId,
        {
          status: "RINGING",
          updatedAt: now
        },
        { session }
      );
      callDocument = await Call.findById(callSession.callId).session(session);
    } else {
      // Create new call document
      const callDoc = await Call.create([{
        userId: callRequest.userId,
        astrologerId: callRequest.astrologerId,
        callType: callRequest.callType,
        direction: "USER_TO_ASTROLOGER",
        status: "RINGING",
        chargesPerMinute: callRequest.ratePerMinute,
        startTime: now,
        meta: {
          requestId: callRequest.requestId,
          sessionId: callSession.sessionId,
          acceptedAt: now
        }
      }], { session });

      callDocument = callDoc[0];

      // Link to session and request
      await Promise.all([
        CallSession.findByIdAndUpdate(
          callSession._id,
          { callId: callDocument._id },
          { session }
        ),
        CallRequest.findByIdAndUpdate(
          callRequest._id,
          { callId: callDocument._id },
          { session }
        )
      ]);
    }

    hasCommitted = true;
    await session.commitTransaction();

    console.log("✅ Transaction committed for call acceptance");

    // ========== CLEAR REQUEST EXPIRY TIMER ==========
    clearCallTimer(requestId, 'request');

    // ========== START RINGING TIMER (45 seconds) ==========
    startRingingTimer(callSession.sessionId, callRequest.userId, callRequest.astrologerId);

    // ========== NOTIFY USER ==========
    const payload = {
      requestId: callRequest.requestId,
      sessionId: callSession.sessionId,
      callId: callDocument._id,
      callType: callRequest.callType,
      astrologerInfo: {
        id: astrologerId,
        name: req.user.fullName || "Astrologer",
        avatar: req.user.avatar || ""
      },
      ratePerMinute: callRequest.ratePerMinute,
      acceptedAt: now,
      ringingExpiresAt: new Date(Date.now() + 45 * 1000),
      message: "Astrologer accepted your call! Please answer within 45 seconds."
    };

    // Socket notification to user
    try {
      emitSocketEvent(
        req,
        callRequest.userId.toString(),
        ChatEventsEnum.CALL_ACCEPTED_EVENT,
        payload
      );
      console.log(`✅ Socket event sent to user: ${callRequest.userId}`);
    } catch (socketError) {
      console.error("Failed to send socket event:", socketError.message);
    }

    // Push notification to user
    try {
      await sendNotification({
        userId: callRequest.userId,
        title: "Call Accepted! 📞",
        body: `${req.user.fullName || "Astrologer"} accepted your call`,
        type: "call_accepted",
        data: {
          requestId: callRequest.requestId,
          sessionId: callSession.sessionId,
          callType: callRequest.callType,
          astrologerId: astrologerId,
          astrologerName: req.user.fullName
        }
      });
      console.log("✅ Push notification sent to user");
    } catch (notifError) {
      console.error("Failed to send push notification:", notifError.message);
    }

    // ========== RETURN SUCCESS ==========
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          requestId: callRequest.requestId,
          sessionId: callSession.sessionId,
          callId: callDocument._id,
          status: "RINGING",
          callType: callRequest.callType,
          ratePerMinute: callRequest.ratePerMinute,
          acceptedAt: now,
          ringingTimeout: 45, // seconds
          userInfo: {
            id: callRequest.userId,
            name: callRequest.meta?.callerName || "User"
          },
          nextStep: "Waiting for user to answer the call..."
        },
        "Call accepted successfully! Now ringing user..."
      )
    );

  } catch (error) {
    console.error("❌ Error in acceptCallSession:", {
      message: error.message,
      stack: error.stack,
      requestId: req.params.requestId
    });

    if (!hasCommitted && session.inTransaction()) {
      await session.abortTransaction();
      console.log("Transaction aborted");
    }

    throw error;
  } finally {
    session.endSession();
  }
});

export const endCall = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { sessionId } = req.params;
    const userId = req.user.id;

    // Find session
    const callSession = await CallSession.findOne({
      sessionId,
      $or: [{ userId }, { astrologerId: userId }],
      status: { $in: ["CONNECTED", "ACTIVE", "ON_HOLD"] }
    })
      .populate("callId")
      .session(session);

    if (!callSession) {
      throw new ApiError(404, "Active call not found");
    }

    // Stop billing timer
    stopCallBillingTimer(sessionId);

    const now = new Date();
    const endedBy = userId;
    const endedByRole = req.user.role;

    // Calculate duration and cost
    const connectedAt = callSession.connectedAt || now;
    const totalSeconds = Math.floor((now - connectedAt) / 1000);
    const billedMinutes = Math.ceil(totalSeconds / 60);
    const totalCost = Math.max(
      callSession.minimumCharge,
      billedMinutes * callSession.ratePerMinute
    );

    // Update session
    callSession.status = "COMPLETED";
    callSession.endedAt = now;
    callSession.totalDuration = totalSeconds;
    callSession.billedDuration = billedMinutes * 60;
    callSession.totalCost = totalCost;

    // Update call document
    if (callSession.callId) {
      await Call.findByIdAndUpdate(
        callSession.callId._id,
        {
          status: "COMPLETED",
          endTime: now,
          duration: totalSeconds,
          totalAmount: totalCost,
          endedBy,
          endedByRole
        },
        { session }
      );
    }

    // Process payment if reservation exists
    if (callSession.reservationId) {
      try {
        const settlement = await WalletService.processSessionPayment(callSession.reservationId);
        callSession.paymentStatus = "PAID";
        callSession.platformCommission = settlement.platformCommission || 0;
        callSession.astrologerEarnings = settlement.astrologerEarnings || 0;
      } catch (error) {
        console.error("Payment settlement failed:", error);
        callSession.paymentStatus = "FAILED";
      }
    }

    await callSession.save({ session });

    // Update request
    await CallRequest.findOneAndUpdate(
      { sessionId },
      { status: "COMPLETED" },
      { session }
    );

    hasCommitted = true;
    await session.commitTransaction();

    // Notify both parties
    const payload = {
      sessionId,
      callId: callSession.callId?._id,
      status: "COMPLETED",
      totalCost,
      durationSeconds: totalSeconds,
      billedMinutes,
      endedBy,
      endedAt: now
    };

    emitSocketEvent(
      req,
      callSession.userId.toString(),
      ChatEventsEnum.CALL_ENDED_EVENT,
      payload
    );

    emitSocketEvent(
      req,
      callSession.astrologerId.toString(),
      ChatEventsEnum.CALL_ENDED_EVENT,
      payload
    );

    // Request rating from user
    if (endedByRole === "user") {
      emitSocketEvent(
        req,
        callSession.userId.toString(),
        ChatEventsEnum.CALL_RATING_REQUEST,
        {
          callId: callSession.callId?._id,
          astrologerId: callSession.astrologerId
        }
      );
    }

    return res.status(200).json(new ApiResponse(200, payload, "Call ended successfully"));

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
});

// ==================== REJECT CALL ====================
export const rejectCall = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const astrologerId = req.user.id;

  if (req.user.role !== "astrologer") {
    throw new ApiError(403, "Only astrologers can reject calls");
  }

  const callRequest = await CallRequest.findOne({
    requestId,
    astrologerId,
    status: "PENDING"
  });

  if (!callRequest) {
    throw new ApiError(404, "Call request not found");
  }

  const now = new Date();

  // Update request
  await CallRequest.findByIdAndUpdate(callRequest._id, {
    status: "REJECTED",
    respondedAt: now
  });

  // Update session
  await CallSession.findOneAndUpdate(
    { sessionId: callRequest.sessionId },
    {
      status: "REJECTED",
      endedAt: now
    }
  );

  // Clear timer
  clearCallRequestTimer(requestId);

  // Notify user
  emitSocketEvent(
    req,
    callRequest.userId.toString(),
    ChatEventsEnum.CALL_REJECTED_EVENT,
    {
      requestId,
      sessionId: callRequest.sessionId,
      astrologerId,
      rejectedAt: now,
      message: "Call was rejected by astrologer"
    }
  );

  return res.status(200).json(new ApiResponse(200, {
    requestId,
    status: "REJECTED"
  }, "Call rejected successfully"));
});

// ==================== CANCEL CALL REQUEST ====================
export const cancelCallRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;

  const callRequest = await CallRequest.findOne({
    requestId,
    userId,
    status: "PENDING"
  });

  if (!callRequest) {
    throw new ApiError(404, "Call request not found");
  }

  const now = new Date();

  // Update request
  await CallRequest.findByIdAndUpdate(callRequest._id, {
    status: "CANCELLED",
    respondedAt: now
  });

  // Update session
  await CallSession.findOneAndUpdate(
    { sessionId: callRequest.sessionId },
    {
      status: "CANCELLED",
      endedAt: now
    }
  );

  // Clear timer
  clearCallRequestTimer(requestId);

  // Notify astrologer
  emitSocketEvent(
    req,
    callRequest.astrologerId.toString(),
    ChatEventsEnum.CALL_CANCELLED,
    {
      requestId,
      sessionId: callRequest.sessionId,
      cancelledBy: userId,
      cancelledAt: now
    }
  );

  return res.status(200).json(new ApiResponse(200, {
    requestId,
    status: "CANCELLED"
  }, "Call request cancelled successfully"));
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
      requestId:call.requestId,
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

const startRingingTimer = (sessionId, callId) => {
  const timer = setTimeout(async () => {
    try {
      const callSession = await CallSession.findOne({ sessionId, status: "RINGING" });
      if (callSession) {
        await Promise.all([
          CallSession.findByIdAndUpdate(callSession._id, {
            status: "MISSED",
            endedAt: new Date()
          }),
          Call.findByIdAndUpdate(callId, {
            status: "MISSED",
            endTime: new Date()
          }),
          CallRequest.findOneAndUpdate(
            { sessionId },
            { status: "MISSED" }
          )
        ]);
      }
    } catch (error) {
      console.error("Error in ringing timer:", error);
    }
  }, 45 * 1000); // 45 seconds for user to answer

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


const setCallRequestTimer = (requestId, sessionId, astrologerId, userId) => {
  const timer = setTimeout(async () => {
    try {
      // Mark request as expired
      const callRequest = await CallRequest.findOne({ requestId, status: "PENDING" });
      if (callRequest) {
        await Promise.all([
          CallRequest.findByIdAndUpdate(callRequest._id, { status: "EXPIRED" }),
          CallSession.findOneAndUpdate(
            { sessionId },
            { status: "EXPIRED", endedAt: new Date() }
          )
        ]);

        // Notify both parties
        const io = req.app.get('socketio');
        if (io) {
          io.to(userId.toString()).emit(ChatEventsEnum.CALL_EXPIRED_EVENT, {
            requestId,
            sessionId,
            message: "Call request expired"
          });

          io.to(astrologerId.toString()).emit(ChatEventsEnum.CALL_EXPIRED_EVENT, {
            requestId,
            sessionId,
            message: "Call request expired"
          });
        }
      }
    } catch (error) {
      console.error("Error in call request expiry:", error);
    }
  }, 3 * 60 * 1000); // 3 minutes

  // Store timer reference
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

