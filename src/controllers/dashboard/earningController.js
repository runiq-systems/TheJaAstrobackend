import mongoose from "mongoose";

import { Transaction, Reservation, Payout } from "../../models/Wallet/AstroWallet.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallSession } from "../../models/calllogs/callSession.js";
import mongoose from "mongoose";
import { Transaction, Reservation, Payout } from "../../models/Wallet/AstroWallet.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallSession } from "../../models/calllogs/callSession.js";

/**
 * @desc    Get total lifetime earnings for an astrologer
 * @route   GET /api/earnings/lifetime
 * @access  Astrologer
 */
export const getLifetimeEarnings = async (req, res) => {
    try {
        const astrologerId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(astrologerId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid astrologer ID",
            });
        }

        const astroId = new mongoose.Types.ObjectId(astrologerId);

        /* =====================================================
           1️⃣ TRANSACTIONS (REAL WALLET EARNINGS)
           ===================================================== */
        const transactionAgg = await Transaction.aggregate([
            {
                $match: {
                    userId: astroId,
                    type: "CREDIT",
                    status: "SUCCESS",
                    category: { $in: ["EARNINGS", "CALL_SESSION", "CHAT_SESSION", "LIVE"] },
                },
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: "$amount" },
                    totalCommission: { $sum: "$commissionAmount" },
                    totalTax: { $sum: "$taxAmount" },

                    callEarnings: {
                        $sum: {
                            $cond: [{ $eq: ["$category", "CALL_SESSION"] }, "$amount", 0],
                        },
                    },
                    chatEarnings: {
                        $sum: {
                            $cond: [{ $eq: ["$category", "CHAT_SESSION"] }, "$amount", 0],
                        },
                    },
                    liveEarnings: {
                        $sum: {
                            $cond: [{ $eq: ["$category", "LIVE"] }, "$amount", 0],
                        },
                    },
                },
            },
        ]);

        const tx = transactionAgg[0] || {
            totalEarnings: 0,
            totalCommission: 0,
            totalTax: 0,
            callEarnings: 0,
            chatEarnings: 0,
            liveEarnings: 0,
        };

        /* =====================================================
           2️⃣ PAYOUTS
           ===================================================== */
        const payoutAgg = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astroId,
                    status: "SUCCESS",
                },
            },
            {
                $group: {
                    _id: null,
                    totalPayouts: { $sum: "$netAmount" },
                },
            },
        ]);

        const totalPayouts = payoutAgg[0]?.totalPayouts || 0;

        /* =====================================================
           3️⃣ RESERVATION SUMMARY (SETTLED)
           ===================================================== */
        const reservationAgg = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: astroId,
                    status: "SETTLED",
                },
            },
            {
                $group: {
                    _id: null,
                    totalSessions: { $sum: 1 },
                    totalDurationSec: { $sum: "$totalDurationSec" },
                },
            },
        ]);

        const totalSessions = reservationAgg[0]?.totalSessions || 0;
        const totalDurationMinutes = Math.floor(
            (reservationAgg[0]?.totalDurationSec || 0) / 60
        );

        /* =====================================================
           4️⃣ CALL SESSION MINUTES ✅
           ===================================================== */
        const callMinutesAgg = await CallSession.aggregate([
            {
                $match: {
                    astrologerId: astroId,
                    status: { $in: ["COMPLETED", "AUTO_ENDED"] },
                },
            },
            {
                $group: {
                    _id: null,
                    totalSeconds: {
                        $sum: {
                            $cond: [
                                { $gt: ["$billedDuration", 0] },
                                "$billedDuration",
                                "$totalDuration",
                            ],
                        },
                    },
                },
            },
        ]);

        const totalCallMinutes = Math.floor(
            (callMinutesAgg[0]?.totalSeconds || 0) / 60
        );

        /* =====================================================
           5️⃣ CHAT SESSION MINUTES ✅
           ===================================================== */
        const chatMinutesAgg = await ChatSession.aggregate([
            {
                $match: {
                    astrologerId: astroId,
                    status: { $in: ["COMPLETED", "AUTO_ENDED"] },
                },
            },
            {
                $group: {
                    _id: null,
                    totalSeconds: {
                        $sum: {
                            $cond: [
                                { $gt: ["$billedDuration", 0] },
                                "$billedDuration",
                                "$activeDuration",
                            ],
                        },
                    },
                },
            },
        ]);

        const totalChatMinutes = Math.floor(
            (chatMinutesAgg[0]?.totalSeconds || 0) / 60
        );

        /* =====================================================
           6️⃣ FINAL CALCULATION
           ===================================================== */
        const pendingBalance = tx.totalEarnings - totalPayouts;

        /* =====================================================
           7️⃣ RESPONSE
           ===================================================== */
        return res.status(200).json({
            success: true,
            data: {
                astrologerId,

                lifetimeEarnings: tx.totalEarnings,
                pendingBalance,

                earningsBreakdown: {
                    call: tx.callEarnings,
                    chat: tx.chatEarnings,
                    live: tx.liveEarnings,
                },

                deductions: {
                    commissionPaid: tx.totalCommission,
                    taxPaid: tx.totalTax,
                },

                payouts: {
                    totalPayouts,
                },

                sessions: {
                    totalSessions,
                    totalDurationMinutes,
                    callMinutes: totalCallMinutes,
                    chatMinutes: totalChatMinutes,
                },
            },
        });
    } catch (error) {
        console.error("Lifetime earnings error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to calculate lifetime earnings",
        });
    }
};
