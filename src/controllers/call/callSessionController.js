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

export const notifyAstrologerAboutCallRequest = async (
  req,
  astrologerId,
  payload
) => {
  // 1️⃣ SOCKET (real-time)
  emitSocketEvent(
    req,
    astrologerId.toString(),
    ChatEventsEnum.CALL_INITIATED_EVENT,
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
      message: "Wants to connect via call",
    }
  );

  // 2️⃣ PUSH (background / killed app)
  await sendCallNotification({
    userId: astrologerId,
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    callType: payload.callType,
    callerId: payload.callerId,
    callerName: payload.callerName,
    callerAvatar: payload.callerImage,
    ratePerMinute: payload.ratePerMinute,
    expiresAt: payload.expiresAt,
  });
};


function generateTxId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


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

    // === VALIDATIONS ===
    if (!astrologerId) throw new ApiError(400, "Astrologer ID is required");
    if (req.user.role === "astrologer") throw new ApiError(403, "Astrologers cannot initiate calls");
    if (astrologerId.toString() === userId.toString()) throw new ApiError(400, "You cannot call yourself");
    if (!["AUDIO", "VIDEO"].includes(callType.toUpperCase())) throw new ApiError(400, "Invalid call type");

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId);

    // === CHECK ASTROLOGER EXISTS & ONLINE ===
    const astrologer = await User.findOne({
      _id: astrologerObjectId,
      role: "astrologer",
      userStatus: "Active",
      isSuspend: false,
      isOnline: true
    }).session(session).select("fullName avatar callRate");

    if (!astrologer) throw new ApiError(404, "Astrologer not found, offline, or suspended");

    const astroProfile = await Astrologer.findOne({ userId: astrologerObjectId }).session(session);
    if (!astroProfile) throw new ApiError(404, "Astrologer profile not completed");

    const ratePerMinute = astroProfile.ratepermin || astrologer.callRate || 50;

    // === CHECK IF THERE IS ALREADY AN ACTIVE CALL BETWEEN THESE TWO ===
    const existingSession = await CallSession.findOne({
      $or: [
        { userId, astrologerId: astrologerObjectId },
        { userId: astrologerObjectId, astrologerId: userId }
      ],
      status: { $in: ["REQUESTED", "RINGING", "CONNECTED", "ACTIVE"] }
    }).session(session);

    if (existingSession) {
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, {
        sessionId: existingSession.sessionId,
        requestId: existingSession.requestId,
        status: existingSession.status,
        callType: existingSession.callType,
        ratePerMinute: existingSession.ratePerMinute,
        message: `Existing ${existingSession.status.toLowerCase()} call found`
      }, "Existing call session found"));
    }

    // === CHECK IF ASTROLOGER IS ALREADY IN A CALL (BUSY) ===
    const astrologerBusy = await CallSession.findOne({
      astrologerId: astrologerObjectId,
      status: { $in: ["RINGING", "CONNECTED", "ACTIVE"] }
    }).session(session);

    if (astrologerBusy) {
      throw new ApiError(400, "Astrologer is currently busy in another call");
    }

    // === GENERATE IDs ===
    const requestId = CallRequest.generateRequestId();
    const sessionId = CallSession.generateSessionId();

    // === CREATE CALL DOCUMENTS (NO MONEY RESERVED) ===
    const callSession = await CallSession.create([{
      sessionId,
      requestId,
      userId,
      astrologerId: astrologerObjectId,
      callType: callType.toUpperCase(),
      ratePerMinute,
      status: "REQUESTED",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3 minutes to accept
      minimumCharge: ratePerMinute,
      meta: {
        callerName: userName,
        callerImage: userAvatar,
        userMessage: userMessage?.trim() || ""
      }
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

    // Link callId
    await CallSession.findByIdAndUpdate(
      callSession[0]._id,
      { callId: callDoc[0]._id },
      { session }
    );

    hasCommitted = true;
    await session.commitTransaction();

    // === NOTIFY ASTROLOGER ===
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

    // === SET EXPIRY TIMER (auto-cancel after 3 mins if not accepted) ===
    setCallRequestTimer(requestId, sessionId, astrologerObjectId, userId);

    return res.status(201).json(
      new ApiResponse(201, {
        requestId,
        sessionId,
        callType: callType.toUpperCase(),
        ratePerMinute,
        expiresAt: new Date(Date.now() + 3 * 60 * 1000),
        status: "PENDING"
      }, "Call request sent successfully")
    );

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) {
      await session.abortTransaction();
    }
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
  const mongoSession = await mongoose.startSession();
  let sessionId;

  try {
    sessionId = req.params.sessionId || req.params.sessionid || req.body.sessionId;
    if (!sessionId) throw new ApiError(400, "sessionId is required");

    const userId = req.user._id;

    await mongoSession.withTransaction(async () => {
      const callSession = await CallSession.findOne({
        sessionId,
        userId,
        status: "RINGING"
      }).session(mongoSession);

      if (!callSession) throw new ApiError(404, "Call session not found");

      const now = new Date();
      const ratePerMinute = callSession.ratePerMinute;

      // Reserve 10 minutes upfront
      const estimatedMinutes = 10;
      const estimatedCost = ratePerMinute * estimatedMinutes;

      // Check balance
      const balanceCheck = await WalletService.checkBalance({
        userId,
        amount: estimatedCost,
        currency: "INR"
      });

      if (!balanceCheck.hasSufficientBalance) {
        throw new ApiError(402, "Insufficient balance to start call", {
          required: estimatedCost,
          available: balanceCheck.availableBalance,
          shortfall: balanceCheck.shortfall
        });
      }

      // Calculate commission
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
        commissionDetails,
        status: "RESERVED",
        startAt: now,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        meta: { estimatedMinutes }
      }], { session: mongoSession });

      // Lock money in wallet
      await WalletService.reserveAmount({
        userId,
        amount: estimatedCost,
        reservationId: reservation[0]._id,
        sessionType: "CALL",
        description: `Reserved ₹${estimatedCost} for ${callSession.callType} call`,
        session: mongoSession
      });

      // Update session to CONNECTED
      callSession.status = "CONNECTED";
      callSession.connectedAt = now;
      callSession.reservationId = reservation[0]._id;
      await callSession.save({ session: mongoSession });

      const call = await Call.findById(callSession.callId).session(mongoSession);
      if (call) {
        call.connectTime = now;
        call.status = "CONNECTED";
        call.reservationId = reservation[0]._id;
        await call.save({ session: mongoSession });
      }
    });

    // After transaction success
    const callSession = await CallSession.findOne({ sessionId });

    // Clear ringing timeout
    clearCallTimer(sessionId, "ringing");

    // Start billing timer
    const estimatedMinutes = 10;
    startBillingTimer(
      sessionId,
      callSession.callId,
      callSession.ratePerMinute,
      callSession.reservationId,
      estimatedMinutes
    );

    // Mark reservation as ONGOING
    await Reservation.findByIdAndUpdate(callSession.reservationId, {
      status: "ONGOING"
    });

    const payload = {
      sessionId,
      callId: callSession.callId.toString(),
      status: "CONNECTED",
      ratePerMinute: callSession.ratePerMinute,
      connectTime: new Date(),
      reservedAmount: callSession.ratePerMinute * 10
    };

    // Notify both users
    emitSocketEvent(req, callSession.userId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);
    emitSocketEvent(req, callSession.astrologerId.toString(), ChatEventsEnum.CALL_CONNECTED, payload);

    return res.status(200).json(
      new ApiResponse(200, payload, "Call connected successfully. Billing started.")
    );

  } catch (error) {
    // Handle idempotency
    if (error.statusCode === 200) {
      const fallbackSession = await CallSession.findOne({ sessionId });
      if (fallbackSession && ["CONNECTED", "ACTIVE"].includes(fallbackSession.status)) {
        return res.status(200).json(
          new ApiResponse(200, { sessionId, status: "CONNECTED" }, "Call already connected")
        );
      }
    }
    throw error;
  } finally {
    mongoSession.endSession();
  }
});

// Updated endCall (deduct actual, refund excess)
// export const endCall = asyncHandler(async (req, res) => {
//   const session = await mongoose.startSession();
//   let hasCommitted = false;

//   try {
//     session.startTransaction();

//     const { sessionId } = req.params;
//     const userId = req.user._id;

//     const callSession = await CallSession.findOne({
//       sessionId,
//       $or: [{ userId }, { astrologerId: userId }],
//       status: { $in: ["CONNECTED", "ACTIVE"] }
//     }).session(session);

//     if (!callSession) {
//       await session.abortTransaction();
//       return res.status(200).json(new ApiResponse(200, {}, "Call already ended"));
//     }

//     const now = new Date();
//     const connectedAt = callSession.connectedAt || now;
//     const totalSeconds = Math.floor((now - connectedAt) / 1000);
//     const billedMinutes = Math.ceil(totalSeconds / 60);
//     const ratePerMinute = callSession.ratePerMinute;
//     const finalCost = billedMinutes * ratePerMinute;

//     console.log(`[BILLING CALCULATION] Session: ${sessionId}`);
//     console.log(`  - Duration: ${totalSeconds}s (${(totalSeconds / 60).toFixed(2)} min)`);
//     console.log(`  - Billed minutes: ${billedMinutes} min`);
//     console.log(`  - Rate: ₹${ratePerMinute}/min`);
//     console.log(`  - Final cost: ₹${finalCost}`);

//     // Stop billing timer
//     stopBillingTimer(sessionId);
//     clearReminders(sessionId);

//     // Update session & call
//     callSession.status = "COMPLETED";
//     callSession.endedAt = now;
//     callSession.totalDuration = totalSeconds;
//     callSession.billedDuration = billedMinutes * 60;
//     callSession.totalCost = finalCost;
//     await callSession.save({ session });

//     const call = await Call.findById(callSession.callId).session(session);
//     if (call) {
//       call.status = "COMPLETED";
//       call.endTime = now;
//       call.duration = totalSeconds;
//       call.totalAmount = finalCost;
//       call.endedBy = userId;
//       await call.save({ session });
//     }

//     // FINAL SETTLEMENT WITH PROPER REFUND
//     let refundedAmount = 0;
//     let astrologerEarnings = 0;
//     let platformEarnings = 0;

//     if (callSession.reservationId) {
//       const reservation = await Reservation.findById(callSession.reservationId).session(session);
//       if (reservation) {
//         const reservedAmount = reservation.lockedAmount || 0;

//         // Calculate actual used amount vs reserved amount
//         const usedAmount = finalCost;
//         refundedAmount = Math.max(0, reservedAmount - usedAmount);

//         // Calculate commission (20% platform, 80% astrologer)
//         platformEarnings = Math.round(usedAmount * 0.20);
//         astrologerEarnings = usedAmount - platformEarnings;

//         console.log(`[SETTLEMENT] Session: ${sessionId}`);
//         console.log(`  - Reserved: ₹${reservedAmount}`);
//         console.log(`  - Used: ₹${usedAmount} (${billedMinutes} min × ₹${ratePerMinute}/min)`);
//         console.log(`  - Refund: ₹${refundedAmount}`);
//         console.log(`  - Platform: ₹${platformEarnings}`);
//         console.log(`  - Astrologer: ₹${astrologerEarnings}`);

//         // 1. RELEASE ALL LOCKED AMOUNT BACK TO AVAILABLE
//         console.log(`[WALLET] Step 1: Releasing ₹${reservedAmount} from locked to available`);
//         await WalletService.releaseAmount({
//           userId,
//           amount: reservedAmount,
//           currency: "INR",
//           reservationId: reservation._id,
//           description: `Release reserved amount ₹${reservedAmount} back to available balance`,
//           session
//         });

//         // 2. DEBIT ONLY THE USED AMOUNT FROM USER
//         if (usedAmount > 0) {
//           console.log(`[WALLET] Step 2: Debiting ₹${usedAmount} for actual usage`);
//           await WalletService.debit({
//             userId,
//             amount: usedAmount,
//             currency: "INR",
//             category: "CALL_SESSION",
//             subcategory: callSession.callType,
//             description: `Call session: ${billedMinutes} min × ₹${ratePerMinute}/min`,
//             reservationId: reservation._id,
//             meta: {
//               sessionId,
//               billedMinutes,
//               duration: totalSeconds,
//               astrologerId: callSession.astrologerId,
//               ratePerMinute
//             },
//             session
//           });
//         }

//         // 3. CREDIT ASTROLOGER EARNINGS
//         if (astrologerEarnings > 0) {
//           console.log(`[WALLET] Step 3: Crediting astrologer ₹${astrologerEarnings}`);
//           await WalletService.credit({
//             userId: callSession.astrologerId,
//             amount: astrologerEarnings,
//             currency: "INR",
//             category: "EARNINGS",
//             subcategory: "CALL_SESSION",
//             description: `Earnings from ${billedMinutes} min call (₹${ratePerMinute}/min)`,
//             meta: {
//               sessionId,
//               callSessionId: callSession._id,
//               billedMinutes,
//               duration: totalSeconds,
//               ratePerMinute,
//               commissionPercent: 20
//             },
//             session
//           });

//           // Update astrologer earnings in reservation
//           reservation.astrologerEarnings = astrologerEarnings;
//         }

//         // Update reservation with final settlement
//         reservation.status = "SETTLED";
//         reservation.totalCost = usedAmount;
//         reservation.platformEarnings = platformEarnings;
//         reservation.billedMinutes = billedMinutes;
//         reservation.totalDurationSec = totalSeconds;
//         reservation.refundedAmount = refundedAmount;
//         reservation.settledAt = now;
//         await reservation.save({ session });

//         // Update call session with payment info
//         callSession.platformCommission = platformEarnings;
//         callSession.astrologerEarnings = astrologerEarnings;
//         callSession.paymentStatus = "PAID";
//         await callSession.save({ session });

//         // 4. VERIFY USER'S FINAL BALANCE
//         const finalBalance = await WalletService.getBalance(userId, "INR");
//         console.log(`[WALLET] Final balance for user ${userId}:`);
//         console.log(`  - Available: ₹${finalBalance.available}`);
//         console.log(`  - Locked: ₹${finalBalance.locked}`);
//         console.log(`  - Total: ₹${finalBalance.total}`);
//       }
//     }

//     hasCommitted = true;
//     await session.commitTransaction();

//     // Notify both parties
//     const payload = {
//       sessionId,
//       status: "COMPLETED",
//       totalCost: finalCost,
//       refundedAmount,
//       durationSeconds: totalSeconds,
//       billedMinutes,
//       ratePerMinute,
//       endedAt: now,
//       astrologerEarnings,
//       platformEarnings,
//       calculation: {
//         actualMinutes: (totalSeconds / 60).toFixed(2),
//         roundedMinutes: billedMinutes,
//         rate: ratePerMinute,
//         total: finalCost
//       }
//     };

//     emitSocketEvent(req, callSession.userId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);
//     emitSocketEvent(req, callSession.astrologerId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);

//     return res.status(200).json(new ApiResponse(200, payload, "Call ended & settlement completed"));

//   } catch (error) {
//     if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
//     throw error;
//   } finally {
//     session.endSession();
//   }
// });

// ✅ Smart End Call — handles astrologer early end & automatic refund
export const endCall = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let hasCommitted = false;

  try {
    session.startTransaction();

    const { sessionId } = req.params;
    const requesterId = req.user._id; // Can be astrologer or user

    // Find active call session
    const callSession = await CallSession.findOne({
      sessionId,
      status: { $in: ["CONNECTED", "ACTIVE"] },
    }).session(session);

    if (!callSession) {
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, {}, "Call already ended"));
    }

    // Prevent double processing
    if (callSession.endedAt) {
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, {}, "Call already ended"));
    }

    const now = new Date();
    const connectedAt = callSession.connectedAt || now;
    const totalSeconds = Math.floor((now - connectedAt) / 1000);
    const billedMinutes = Math.ceil(totalSeconds / 60);
    const ratePerMinute = callSession.ratePerMinute || 0;
    const finalCost = billedMinutes * ratePerMinute;

    const isAstrologer = requesterId.toString() === callSession.astrologerId.toString();

    console.log(
      `[END CALL] ${isAstrologer ? "Astrologer" : "User"} ended session ${sessionId}`
    );
    console.log(`[BILL] Duration: ${totalSeconds}s (${(totalSeconds / 60).toFixed(2)} min)`);
    console.log(`[BILL] Final cost: ₹${finalCost}`);

    // Stop timers
    stopBillingTimer(sessionId);
    clearReminders(sessionId);

    // Update callSession + Call
    callSession.status = "COMPLETED";
    callSession.endedAt = now;
    callSession.totalDuration = totalSeconds;
    callSession.billedDuration = billedMinutes * 60;
    callSession.totalCost = finalCost;
    callSession.endedBy = requesterId;

    const call = await Call.findById(callSession.callId).session(session);
    if (call) {
      call.status = "COMPLETED";
      call.endTime = now;
      call.duration = totalSeconds;
      call.totalAmount = finalCost;
      call.endedBy = requesterId;
      await call.save({ session });
    }

    // ---- Settlement Logic ----
    let refundedAmount = 0;
    let astrologerEarnings = 0;
    let platformEarnings = 0;

    if (callSession.reservationId) {
      const reservation = await Reservation.findById(callSession.reservationId).session(session);

      if (reservation) {
        const reservedAmount = reservation.lockedAmount || 0;
        const usedAmount = finalCost;

        refundedAmount = Math.max(0, reservedAmount - usedAmount);
        platformEarnings = Math.round(usedAmount * 0.20);
        astrologerEarnings = usedAmount - platformEarnings;

        console.log(
          `[SETTLEMENT] Reserved ₹${reservedAmount}, Used ₹${usedAmount}, Refund ₹${refundedAmount}`
        );

        // 1️⃣ Release all locked amount to available
        await WalletService.releaseAmount({
          userId: callSession.userId,
          amount: reservedAmount,
          currency: "INR",
          reservationId: reservation._id,
          description: `Released ₹${reservedAmount} from locked balance`,
          session,
        });

        // 2️⃣ Debit only the used amount
        if (usedAmount > 0) {
          await WalletService.debit({
            userId: callSession.userId,
            amount: usedAmount,
            currency: "INR",
            category: "CALL_SESSION",
            subcategory: callSession.callType,
            description: `Call session: ${billedMinutes} min × ₹${ratePerMinute}/min`,
            reservationId: reservation._id,
            meta: {
              sessionId,
              billedMinutes,
              duration: totalSeconds,
              astrologerId: callSession.astrologerId,
            },
            session,
          });
        }

        // 3️⃣ Credit astrologer earnings (if call > 0 sec)
        if (astrologerEarnings > 0 && totalSeconds > 5) {
          await WalletService.credit({
            userId: callSession.astrologerId,
            amount: astrologerEarnings,
            currency: "INR",
            category: "EARNINGS",
            subcategory: "CALL_SESSION",
            description: `Earnings for ${billedMinutes} min call (₹${ratePerMinute}/min)`,
            meta: {
              sessionId,
              commissionPercent: 20,
            },
            session,
          });
        }

        // 4️⃣ Update reservation
        reservation.status = "SETTLED";
        reservation.totalCost = usedAmount;
        reservation.platformEarnings = platformEarnings;
        reservation.astrologerEarnings = astrologerEarnings;
        reservation.refundedAmount = refundedAmount;
        reservation.billedMinutes = billedMinutes;
        reservation.totalDurationSec = totalSeconds;
        reservation.settledAt = now;
        await reservation.save({ session });

        callSession.platformCommission = platformEarnings;
        callSession.astrologerEarnings = astrologerEarnings;
        callSession.paymentStatus = "PAID";
        await callSession.save({ session });

        // 5️⃣ Auto refund unused balance instantly (only if astrologer ended)
        if (isAstrologer && refundedAmount > 0) {
          await WalletService.credit({
            userId: callSession.userId,
            amount: refundedAmount,
            currency: "INR",
            category: "REFUND",
            subcategory: "CALL_END",
            description: `Refund of ₹${refundedAmount} for unused balance`,
            meta: { sessionId },
            session,
          });

          console.log(`[AUTO REFUND] ₹${refundedAmount} credited to user instantly`);
        }
      }
    }

    hasCommitted = true;
    await session.commitTransaction();

    // ---- Notify Both ----
    const payload = {
      sessionId,
      status: "COMPLETED",
      endedBy: requesterId,
      totalCost: finalCost,
      refundedAmount,
      billedMinutes,
      ratePerMinute,
      astrologerEarnings,
      platformEarnings,
      durationSeconds: totalSeconds,
      endedAt: now,
    };

    emitSocketEvent(req, callSession.userId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);
    emitSocketEvent(req, callSession.astrologerId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);

    return res
      .status(200)
      .json(new ApiResponse(200, payload, "Call ended successfully and settlement completed"));
  } catch (error) {
    if (!hasCommitted && session.inTransaction()) await session.abortTransaction();
    console.error("❌ [endCall Error]:", error);
    return res.status(500).json(new ApiResponse(500, {}, "Error ending call"));
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

    if (req.user.role !== "astrologer")
      throw new ApiError(403, "Only astrologers can reject calls");

    const callRequest = await CallRequest.findOne({
      requestId,
      astrologerId,
      status: "PENDING"
    }).session(session);

    if (!callRequest)
      throw new ApiError(404, "Call request not found or already handled");

    const now = new Date();

    // Update request
    callRequest.status = "REJECTED";
    callRequest.respondedAt = now;
    await callRequest.save({ session });

    // Update session
    const callSession = await CallSession.findOneAndUpdate(
      { sessionId: callRequest.sessionId },
      { status: "REJECTED", endedAt: now },
      { session, new: true }
    );

    // Update main call log
    await Call.findByIdAndUpdate(
      callSession.callId,
      { status: "REJECTED", endTime: now },
      { session }
    );

    hasCommitted = true;
    await session.commitTransaction();

    // Clear expiry timer
    clearCallTimer(requestId, 'request');

    // Notify user
    emitSocketEvent(req, callRequest.userId.toString(), ChatEventsEnum.CALL_REJECTED_EVENT, {
      requestId,
      sessionId: callRequest.sessionId,
      rejectedAt: now,
      message: "Astrologer rejected the call"
    });

    return res.status(200).json(
      new ApiResponse(200, { requestId, status: "REJECTED" }, "Call rejected successfully")
    );

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) {
      await session.abortTransaction();
    }
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

    const callRequest = await CallRequest.findOne({
      requestId,
      userId,
      status: "PENDING"
    }).session(session);

    if (!callRequest)
      throw new ApiError(404, "Call request not found or already handled");

    const now = new Date();

    // Update request
    callRequest.status = "CANCELLED";
    callRequest.respondedAt = now;
    await callRequest.save({ session });

    // Update session
    const callSession = await CallSession.findOneAndUpdate(
      { sessionId: callRequest.sessionId },
      { status: "CANCELLED", endedAt: now },
      { session, new: true }
    );

    // Update main call log
    await Call.findByIdAndUpdate(
      callSession.callId,
      { status: "CANCELLED", endTime: now },
      { session }
    );

    hasCommitted = true;
    await session.commitTransaction();

    // Clear timer
    clearCallTimer(requestId, 'request');

    // Notify astrologer
    emitSocketEvent(req, callRequest.astrologerId.toString(), ChatEventsEnum.CALL_CANCELLED, {
      requestId,
      sessionId: callRequest.sessionId,
      cancelledAt: now,
      message: "User cancelled the call request"
    });

    return res.status(200).json(
      new ApiResponse(200, { requestId, status: "CANCELLED" }, "Call request cancelled successfully")
    );

  } catch (error) {
    if (!hasCommitted && session.inTransaction()) {
      await session.abortTransaction();
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
      if (status === "ACTIVE") {
        // Map to frontend's CONNECTED/ACTIVE status
        filter.status = { $in: ["CONNECTED", "ACTIVE"] };
      } else if (status === "COMPLETED_CALLS") {
        filter.status = "COMPLETED";
      } else {
        // Ensure we use frontend-compatible statuses
        const statusMapping = {
          'REQUESTED': 'REQUESTED',
          'ACCEPTED': 'ACCEPTED',
          'RINGING': 'RINGING',
          'CONNECTED': 'CONNECTED',
          'ACTIVE': 'ACTIVE',
          'ON_HOLD': 'ON_HOLD',
          'COMPLETED': 'COMPLETED',
          'REJECTED': 'REJECTED',
          'MISSED': 'MISSED',
          'CANCELLED': 'CANCELLED',
          'FAILED': 'FAILED',
          'EXPIRED': 'EXPIRED',
          'AUTO_ENDED': 'AUTO_ENDED'
        };

        filter.status = statusMapping[status] || status;
      }
    }

    // Date range (based on call start time)
    if (dateFrom || dateTo) {
      filter.startTime = {};
      if (dateFrom) filter.startTime.$gte = new Date(dateFrom);
      if (dateTo) filter.startTime.$lte = new Date(dateTo);
    }

    // Search: call _id, user fullName, phone
    // FIXED SEARCH: Handle _id separately (exact match only) + regex on string fields
    if (search?.trim()) {
      const searchTerm = search.trim();
    
      // Prepare $or for string fields
      const regex = new RegExp(searchTerm, 'i');
    
      filter.$or = [
        // Regex search on user name and phone
        { "userId.fullName": regex },
        { "userId.phone": regex },
      ];
    
      // Optional: If search looks like a valid ObjectId (24 hex chars), match it exactly
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(searchTerm);
      if (isObjectId) {
        filter.$or.push({ _id: searchTerm });
      }
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
      callId: call.callId || call._id,
      requestId: call.requestId,
      sessionId: call.sessionId,
      callType: call.callType,
      direction: call.direction,
      status: call.status,

      user: call.userId,

      ratePerMinute: call.ratePerMinute,
      totalAmount: call.totalCost || 0,
      duration: call.totalDuration || 0,
      billedDuration: call.billedDuration || 0,

      connectTime: call.connectedAt,
      startTime: call.requestedAt,
      endTime: call.endedAt,

      userRating: call.userRating?.stars,
      userFeedback: call.userRating?.review,

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

// Replace the current startBillingTimer function with this:
const startBillingTimer = async (
  sessionId,
  callId,
  ratePerMinute,
  reservationId,
  estimatedMinutes = 10
) => {
  if (billingTimers.has(sessionId)) {
    console.log(`[CALL] Billing already active for session: ${sessionId}`);
    return;
  }

  console.log(
    `[CALL] Starting billing timer for session: ${sessionId}, Estimated: ${estimatedMinutes} mins`
  );

  // Clear any existing timer first
  stopBillingTimer(sessionId);

  const startedAt = new Date();
  const sessionDurationMs = estimatedMinutes * 60 * 1000;

  // Store session details
  billingTimers.set(sessionId, {
    startedAt,
    reservationId,
    callId,
    ratePerMinute,
    estimatedMinutes
  });

  // Set up auto-end timer
  const autoEndTimer = setTimeout(async () => {
    console.log(`[CALL] Auto-end triggered for session: ${sessionId}`);
    await handleCallAutoEnd(sessionId, callId, reservationId);
  }, sessionDurationMs);

  autoEndTimers.set(sessionId, autoEndTimer);

  // Set up reminders
  setupCallReminders(sessionId, estimatedMinutes);

  // Start per-minute billing interval
  const interval = setInterval(async () => {
    try {
      const session = await CallSession.findOne({ sessionId, status: "CONNECTED" });
      if (!session) {
        console.log(`[CALL] Session not found or not connected: ${sessionId}`);
        stopBillingTimer(sessionId);
        return;
      }

      // Update billed duration
      const billedMinutes = Math.floor(session.billedDuration / 60) + 1;
      const billedDuration = billedMinutes * 60;

      // Calculate current cost
      const currentCost = billedMinutes * ratePerMinute;

      console.log(`[CALL] Billing tick for ${sessionId}: ${billedMinutes}m, ₹${currentCost}`);

      // Update session
      await CallSession.findByIdAndUpdate(session._id, {
        billedDuration,
        totalDuration: billedDuration,
        totalCost: currentCost,
        lastActivityAt: new Date()
      });

      // Update reservation
      if (reservationId) {
        await Reservation.findByIdAndUpdate(reservationId, {
          totalCost: currentCost,
          billedMinutes: billedMinutes,
          totalDurationSec: billedDuration,
          status: "ONGOING"
        });
      }

      // Calculate remaining time
      const elapsedMs = billedMinutes * 60 * 1000;
      const remainingMs = Math.max(0, sessionDurationMs - elapsedMs);
      const minutesRemaining = Math.ceil(remainingMs / (60 * 1000));

      // Check if session needs auto-end
      if (remainingMs <= 0) {
        console.log(`[CALL] Time limit reached for session: ${sessionId}`);
        await handleCallAutoEnd(sessionId, callId, reservationId);
        return;
      }

      // Send socket updates
      const billingUpdate = {
        sessionId,
        billedMinutes,
        currentCost,
        ratePerMinute,
        minutesRemaining,
        totalDurationSec: billedDuration
      };

      // Emit to both user and astrologer
      if (session.userId) {
        emitSocketEventGlobal(session.userId.toString(), ChatEventsEnum.BILLING_UPDATE_EVENT, billingUpdate);
      }
      if (session.astrologerId) {
        emitSocketEventGlobal(session.astrologerId.toString(), ChatEventsEnum.BILLING_UPDATE_EVENT, billingUpdate);
      }

    } catch (error) {
      console.error(`[CALL] Billing error for session ${sessionId}:`, error);
      stopBillingTimer(sessionId);
    }
  }, 60000); // Every minute

  // Store the interval
  billingTimers.get(sessionId).interval = interval;

  // Send initial billing update
  const initialUpdate = {
    sessionId,
    billedMinutes: 0,
    currentCost: 0,
    ratePerMinute,
    minutesRemaining: estimatedMinutes,
    totalDurationSec: 0
  };

  // You'll need to get the session to know user and astrologer IDs
  const session = await CallSession.findOne({ sessionId });
  if (session) {
    if (session.userId) {
      emitSocketEventGlobal(session.userId.toString(), ChatEventsEnum.BILLING_UPDATE_EVENT, initialUpdate);
    }
    if (session.astrologerId) {
      emitSocketEventGlobal(session.astrologerId.toString(), ChatEventsEnum.BILLING_UPDATE_EVENT, initialUpdate);
    }
  }
};

// ─────────────────────── STOP BILLING SAFELY ───────────────────────
const stopBillingTimer = (sessionId) => {
  const data = billingTimers.get(sessionId);
  if (data) {
    if (data.interval) {
      clearInterval(data.interval);
    }
    billingTimers.delete(sessionId);
    console.log(`[CALL] Billing stopped for ${sessionId}`);
  }

  // Clear auto-end timer
  if (autoEndTimers.has(sessionId)) {
    clearTimeout(autoEndTimers.get(sessionId));
    autoEndTimers.delete(sessionId);
  }

  // Clear all reminder timers
  clearReminders(sessionId);
  console.log(`[CALL] All timers cleared for session: ${sessionId}`);
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

// Add this function near your other timer management functions (around line 40-50)
const clearReminders = (sessionId) => {
  // Clear all reminder timers for this session
  const reminderKeys = [
    `${sessionId}_5min`,
    `${sessionId}_2min`,
    `${sessionId}_1min`
  ];

  reminderKeys.forEach(key => {
    if (reminderTimers.has(key)) {
      clearTimeout(reminderTimers.get(key));
      reminderTimers.delete(key);
    }
  });

  // Clear from reminderSent map
  reminderSent.delete(`${sessionId}_5min`);
  reminderSent.delete(`${sessionId}_2min`);
  reminderSent.delete(`${sessionId}_1min`);

  console.log(`[CALL] Cleared all reminders for session: ${sessionId}`);
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

const handleCallAutoEnd = async (sessionId, callId, reservationId) => {
  const mongoSession = await mongoose.startSession();

  try {
    await mongoSession.withTransaction(async () => {
      console.log(`[CALL AUTO-END] Processing auto-end for session: ${sessionId}`);

      const callSession = await CallSession.findOne({ sessionId }).session(mongoSession);
      if (!callSession || callSession.status !== "CONNECTED") {
        console.log(`[CALL AUTO-END] Session not found or not connected: ${sessionId}`);
        return;
      }

      const now = new Date();
      const connectedAt = callSession.connectedAt || callSession.startedAt || now;

      // Calculate total duration in seconds
      const totalSeconds = Math.floor((now - connectedAt) / 1000);

      // Don't bill the last 0.5 seconds - subtract half a second from billed duration
      const billedSeconds = Math.max(0, totalSeconds - 0.5);

      // Calculate billed minutes (rounded up, but starting from adjusted seconds)
      const billedMinutes = Math.ceil(billedSeconds / 60);
      const finalCost = billedMinutes * callSession.ratePerMinute;

      console.log(`[CALL AUTO-END] Final calculation for ${sessionId}:`);
      console.log(`  - Total Duration: ${totalSeconds}s`);
      console.log(`  - Billed Duration: ${billedSeconds}s (after removing last 0.5s)`);
      console.log(`  - Billed Minutes: ${billedMinutes} min`);
      console.log(`  - Rate: ₹${callSession.ratePerMinute}/min`);
      console.log(`  - Final cost: ₹${finalCost}`);

      // Update session status
      callSession.status = "COMPLETED";
      callSession.endedAt = now;
      callSession.totalDuration = totalSeconds;
      callSession.billedDuration = billedMinutes * 60; // Store in seconds
      callSession.totalCost = finalCost;
      await callSession.save({ session: mongoSession });

      // Update main call log
      await Call.findByIdAndUpdate(callId, {
        status: "COMPLETED",
        endTime: now,
        duration: totalSeconds,
        totalAmount: finalCost,
        endedBy: callSession.userId // or system
      }, { session: mongoSession });

      // Process final settlement
      if (reservationId) {
        const reservation = await Reservation.findById(reservationId).session(mongoSession);
        if (reservation) {
          const reservedAmount = reservation.lockedAmount || 0;
          const usedAmount = finalCost;
          const refundedAmount = Math.max(0, reservedAmount - usedAmount);

          // Calculate commission (20% platform, 80% astrologer)
          const platformEarnings = Math.round(usedAmount * 0.20);
          const astrologerEarnings = usedAmount - platformEarnings;

          console.log(`[CALL AUTO-END] Settlement details:`);
          console.log(`  - Reserved: ₹${reservedAmount}`);
          console.log(`  - Used: ₹${usedAmount}`);
          console.log(`  - Refund: ₹${refundedAmount}`);
          console.log(`  - Platform: ₹${platformEarnings}`);
          console.log(`  - Astrologer: ₹${astrologerEarnings}`);

          // 1. RELEASE ALL LOCKED AMOUNT
          await WalletService.releaseAmount({
            userId: callSession.userId,
            amount: reservedAmount,
            currency: "INR",
            reservationId: reservation._id,
            description: `Release reserved amount for auto-ended call`,
            session: mongoSession
          });

          // 2. DEBIT USED AMOUNT
          if (usedAmount > 0) {
            await WalletService.debit({
              userId: callSession.userId,
              amount: usedAmount,
              currency: "INR",
              category: "CALL_SESSION",
              subcategory: callSession.callType,
              description: `Auto-ended call: ${billedMinutes} min × ₹${callSession.ratePerMinute}/min`,
              reservationId: reservation._id,
              meta: {
                sessionId,
                billedMinutes,
                totalDuration: totalSeconds,
                billedDuration: billedSeconds,
                astrologerId: callSession.astrologerId,
                ratePerMinute: callSession.ratePerMinute,
                autoEnded: true
              },
              session: mongoSession
            });
          }

          // 3. CREDIT ASTROLOGER EARNINGS
          if (astrologerEarnings > 0) {
            await WalletService.credit({
              userId: callSession.astrologerId,
              amount: astrologerEarnings,
              currency: "INR",
              category: "EARNINGS",
              subcategory: "CALL_SESSION",
              description: `Earnings from ${billedMinutes} min auto-ended call`,
              meta: {
                sessionId,
                billedMinutes,
                totalDuration: totalSeconds,
                billedDuration: billedSeconds,
                ratePerMinute: callSession.ratePerMinute,
                autoEnded: true
              },
              session: mongoSession
            });
          }

          // Update reservation
          reservation.status = "SETTLED";
          reservation.totalCost = usedAmount;
          reservation.billedMinutes = billedMinutes;
          reservation.totalDurationSec = totalSeconds;
          reservation.billedDurationSec = billedSeconds;
          reservation.platformEarnings = platformEarnings;
          reservation.astrologerEarnings = astrologerEarnings;
          reservation.refundedAmount = refundedAmount;
          reservation.settledAt = now;
          await reservation.save({ session: mongoSession });

          // Update call session with payment info
          callSession.platformCommission = platformEarnings;
          callSession.astrologerEarnings = astrologerEarnings;
          callSession.paymentStatus = "PAID";
          await callSession.save({ session: mongoSession });
        }
      }

      console.log(`[CALL AUTO-END] Successfully auto-ended session: ${sessionId}`);
    });

    // Notify both parties after transaction
    const callSession = await CallSession.findOne({ sessionId });
    if (callSession) {
      const payload = {
        sessionId,
        status: "AUTO_ENDED",
        message: "Call auto-ended due to time limit",
        endedAt: new Date(),
        billedMinutes: Math.ceil(callSession.totalDuration / 60),
        totalCost: callSession.totalCost
      };

      emitSocketEventGlobal(callSession.userId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);
      emitSocketEventGlobal(callSession.astrologerId.toString(), ChatEventsEnum.CALL_ENDED_EVENT, payload);
    }

  } catch (error) {
    console.error(`[CALL AUTO-END] Failed to auto-end session ${sessionId}:`, error);
  } finally {
    mongoSession.endSession();
    stopBillingTimer(sessionId);
  }
};

const setupCallReminders = (sessionId, estimatedMinutes) => {
  clearReminders(sessionId);

  // Set reminders at 5, 2, and 1 minute marks
  const reminderTimes = [5, 2, 1];

  reminderTimes.forEach((minutes) => {
    if (estimatedMinutes > minutes) {
      const reminderTimeMs = (estimatedMinutes - minutes) * 60 * 1000;
      const timer = setTimeout(async () => {
        await sendCallReminder(sessionId, minutes);
      }, reminderTimeMs);

      reminderTimers.set(`${sessionId}_${minutes}min`, timer);
    }
  });

  console.log(`[CALL] Set up reminders for session: ${sessionId}`);
};

const sendCallReminder = async (sessionId, minutesRemaining) => {
  try {
    const session = await CallSession.findOne({ sessionId })
      .populate("userId", "fullName")
      .populate("astrologerId", "fullName");

    if (!session) return;

    const reminderPayload = {
      sessionId,
      minutesRemaining,
      message: `Call will auto-end in ${minutesRemaining} minute${minutesRemaining > 1 ? "s" : ""}.`
    };

    // Notify both parties
    if (session.userId) {
      emitSocketEventGlobal(session.userId.toString(), ChatEventsEnum.CALL_REMINDER_EVENT, reminderPayload);
    }
    if (session.astrologerId) {
      emitSocketEventGlobal(session.astrologerId.toString(), ChatEventsEnum.CALL_REMINDER_EVENT, reminderPayload);
    }

    console.log(`[CALL] Sent ${minutesRemaining} min reminder for session: ${sessionId}`);
  } catch (error) {
    console.error(`[CALL] Failed to send reminder:`, error);
  }
};

export async function sendCallNotification({
  userId,
  requestId,
  sessionId,
  callType = "AUDIO",
  callerId,
  callerName,
  callerAvatar = "",
  ratePerMinute,
  expiresAt,
}) {
  try {
    const user = await User.findById(userId).select("deviceToken");

    if (!user || !user.deviceToken) {
      logger.warn(`⚠️ No device token for user: ${userId}`);
      return;
    }

    const message = {
      token: user.deviceToken,

      // 📦 DATA (for navigation & actions) - No 'notification' field for data-only message
      data: {
        type: "incoming_call",  // Matches NotificationType.INCOMING_CALL
        event: "incoming",      // Fallback for frontend checks
        screen: "Call", // Matches frontend navigation screen name
        requestId: String(requestId),
        sessionId: String(sessionId),
        callType,
        callerId: String(callerId),
        callerName,
        callerAvatar:
          callerAvatar ||
          "https://investogram.ukvalley.com/avatars/default.png",
        ratePerMinute: String(ratePerMinute),
        expiresAt: String(expiresAt),
      },

      android: {
        priority: "high",  // Ensures high-priority delivery for data-only messages
      },

      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            'content-available': 1,  // Helps wake iOS app for background handling
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    logger.info(
      `✅ Call notification sent to ${userId}: ${response}`
    );
  } catch (error) {
    console.error("❌ sendCallNotification error:", error);
  }
}
