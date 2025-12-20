import mongoose from "mongoose";

import { Transaction, Reservation, Payout } from "../../models/Wallet/AstroWallet.js";

/**
 * @desc    Calculate total lifetime earnings of an astrologer
 * @route   GET /api/earnings/lifetime/:astrologerId
 * @access  Admin / Astrologer
 */
export const getLifetimeEarnings = async (req, res) => {
    try {
        const astrologerId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(astrologerId)) {
            return res.status(400).json({ success: false, message: "Invalid astrologer ID" });
        }

        const astroObjectId = new mongoose.Types.ObjectId(astrologerId);

        /* ===================== TRANSACTIONS ===================== */
        const transactionAgg = await Transaction.aggregate([
            {
                $match: {
                    entityType: "ASTROLOGER",
                    entityId: astroObjectId,
                    status: "SUCCESS",
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

        const txData = transactionAgg[0] || {
            totalEarnings: 0,
            totalCommission: 0,
            totalTax: 0,
            callEarnings: 0,
            chatEarnings: 0,
            liveEarnings: 0,
        };

        /* ===================== PAYOUTS ===================== */
        const payoutAgg = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astroObjectId,
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

        /* ===================== SESSIONS ===================== */
        const sessionAgg = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: astroObjectId,
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
        const totalDurationSec = sessionAgg[0]?.totalDurationSec || 0;

        /* ===================== FINAL RESPONSE ===================== */
        const pendingBalance = txData.totalEarnings - totalPayouts;

        return res.status(200).json({
            success: true,
            data: {
                astrologerId,

                lifetimeEarnings: txData.totalEarnings,
                pendingBalance,

                earningsBreakdown: {
                    call: txData.callEarnings,
                    chat: txData.chatEarnings,
                    live: txData.liveEarnings,
                },

                deductions: {
                    commissionPaid: txData.totalCommission,
                    taxPaid: txData.totalTax,
                },

                payouts: {
                    totalPayouts,
                },

                sessions: {
                    totalSessions,
                    totalDurationMinutes: Math.floor(totalDurationSec / 60),
                },
            },
        });
    } catch (error) {
        console.error("Lifetime earnings error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to calculate lifetime earnings",
        });
    }
};
