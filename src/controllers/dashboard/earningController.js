import mongoose from "mongoose";

import { Transaction, Reservation, Payout } from "../../models/Wallet/AstroWallet.js";

/**
 * @desc    Get total lifetime earnings for an astrologer
 * @route   GET /api/earnings/lifetime/:astrologerId
 * @access  Admin / Astrologer
 */
export const getLifetimeEarnings = async (req, res) => {
    try {
        const { astrologerId } = req.user._id ? req.user : req.params;
        if (!mongoose.Types.ObjectId.isValid(astrologerId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid astrologer ID",
            });
        }

        const astroId = new mongoose.Types.ObjectId(astrologerId);

        /* =====================================================
           1️⃣ TRANSACTIONS (REAL EARNINGS — WALLET BASED)
           ===================================================== */
        const transactionAgg = await Transaction.aggregate([
            {
                $match: {
                    userId: astroId,                // 🔥 FIX: wallet owner
                    type: "CREDIT",
                    status: "SUCCESS",
                    category: {
                        $in: ["EARNINGS", "CALL_SESSION", "CHAT_SESSION", "LIVE"],
                    },
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
           2️⃣ PAYOUTS (ONLY SUCCESSFUL)
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
           3️⃣ SESSIONS (SETTLED ONLY)
           ===================================================== */
        const sessionAgg = await Reservation.aggregate([
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

        const totalSessions = sessionAgg[0]?.totalSessions || 0;
        const totalDurationMinutes = Math.floor(
            (sessionAgg[0]?.totalDurationSec || 0) / 60
        );

        /* =====================================================
           4️⃣ FINAL CALCULATION
           ===================================================== */
        const pendingBalance = tx.totalEarnings - totalPayouts;

        /* =====================================================
           5️⃣ RESPONSE
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
