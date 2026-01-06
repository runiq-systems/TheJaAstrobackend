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
           DATE RANGE (TODAY – UTC SAFE)
        ===================================================== */
        const startOfToday = new Date();
        startOfToday.setUTCHours(0, 0, 0, 0);

        const endOfToday = new Date();
        endOfToday.setUTCHours(23, 59, 59, 999);

        /* =====================================================
           1️⃣ LIFETIME TRANSACTIONS (SOURCE OF TRUTH)
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
                        $sum: { $cond: [{ $eq: ["$category", "CALL_SESSION"] }, "$amount", 0] },
                    },
                    chatEarnings: {
                        $sum: { $cond: [{ $eq: ["$category", "CHAT_SESSION"] }, "$amount", 0] },
                    },
                    liveEarnings: {
                        $sum: { $cond: [{ $eq: ["$category", "LIVE"] }, "$amount", 0] },
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
           2️⃣ TODAY EARNINGS (TRANSACTION-BASED)
        ===================================================== */
        const todayTxAgg = await Transaction.aggregate([
            {
                $match: {
                    userId: astroId,
                    type: "CREDIT",
                    status: "SUCCESS",
                    category: { $in: ["CALL_SESSION", "CHAT_SESSION", "LIVE"] },
                    createdAt: { $gte: startOfToday, $lte: endOfToday },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$amount" },
                    commission: { $sum: "$commissionAmount" },
                    tax: { $sum: "$taxAmount" },

                    call: {
                        $sum: { $cond: [{ $eq: ["$category", "CALL_SESSION"] }, "$amount", 0] },
                    },
                    chat: {
                        $sum: { $cond: [{ $eq: ["$category", "CHAT_SESSION"] }, "$amount", 0] },
                    },
                    live: {
                        $sum: { $cond: [{ $eq: ["$category", "LIVE"] }, "$amount", 0] },
                    },
                },
            },
        ]);

        const todayTx = todayTxAgg[0] || {
            total: 0,
            commission: 0,
            tax: 0,
            call: 0,
            chat: 0,
            live: 0,
        };

        /* =====================================================
           3️⃣ PAYOUTS (LIFETIME)
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
           4️⃣ CALL MINUTES (TODAY)
        ===================================================== */
        const todayCallMinutesAgg = await CallSession.aggregate([
            {
                $match: {
                    astrologerId: astroId,
                    status: { $in: ["COMPLETED", "AUTO_ENDED"] },
                    createdAt: { $gte: startOfToday, $lte: endOfToday },
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

        const todayCallMinutes = Math.floor(
            (todayCallMinutesAgg[0]?.totalSeconds || 0) / 60
        );

        /* =====================================================
           5️⃣ CHAT MINUTES (TODAY)
        ===================================================== */
        const todayChatMinutesAgg = await ChatSession.aggregate([
            {
                $match: {
                    astrologerId: astroId,
                    status: { $in: ["COMPLETED", "AUTO_ENDED"] },
                    createdAt: { $gte: startOfToday, $lte: endOfToday },
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

        const todayChatMinutes = Math.floor(
            (todayChatMinutesAgg[0]?.totalSeconds || 0) / 60
        );

        /* =====================================================
           6️⃣ FINAL CALCULATIONS
        ===================================================== */
        const pendingBalance = tx.totalEarnings - totalPayouts;

        /* =====================================================
           7️⃣ RESPONSE
        ===================================================== */
        return res.status(200).json({
            success: true,
            data: {
                astrologerId,

                lifetime: {
                    earnings: tx.totalEarnings,
                    pendingBalance,
                    breakdown: {
                        call: tx.callEarnings,
                        chat: tx.chatEarnings,
                        live: tx.liveEarnings,
                    },
                    deductions: {
                        commissionPaid: tx.totalCommission,
                        taxPaid: tx.totalTax,
                    },
                    payouts: totalPayouts,
                },

                todayEarnings: {
                    total: todayTx.total,
                    breakdown: {
                        call: todayTx.call,
                        chat: todayTx.chat,
                        live: todayTx.live,
                    },
                    deductions: {
                        commission: todayTx.commission,
                        tax: todayTx.tax,
                    },
                    sessions: {
                        callMinutes: todayCallMinutes,
                        chatMinutes: todayChatMinutes,
                    },
                },
            },
        });
    } catch (error) {
        console.error("Lifetime earnings error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to calculate earnings",
        });
    }
};



