import mongoose from "mongoose";
import { CallSession } from "../../models/calllogs/callSession.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallRequest } from "../../models/calllogs/callRequest.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { Transaction } from "../../models/Wallet/AstroWallet.js";
import { Payout } from "../../models/Wallet/AstroWallet.js";

const { ObjectId } = mongoose.Types;

// Helper: Today in IST (Indian Standard Time)
const getISTRange = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    const startOfDay = new Date(istNow);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startUTC = new Date(startOfDay.getTime() - istOffset);

    const endOfDay = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { todayStart: startUTC, todayEnd: endOfDay };
};

export const getAstrologerDashboard = async (req, res) => {
    try {
        const astrologerId = req.user._id;
        if (!astrologerId) return res.status(401).json({ message: "Unauthorized" });

        const { todayStart, todayEnd } = getISTRange();

        // Single aggregation pipeline for maximum performance
        const [
            earnings,
            todayStats,
            ratingResult,
            repeatClientsCount,
            pendingPayouts,
            incomingRequests,
            ongoingSession,
            recentSession
        ] = await Promise.all([
            // 1. Total Earnings (All Time)
            Transaction.aggregate([
                {
                    $match: {
                        entityId: new ObjectId(astrologerId),
                        entityType: "ASTROLOGER",
                        category: "EARNINGS",
                        status: "SUCCESS"
                    }
                },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),

            // 2. Today's Earnings + Consultations
            Transaction.aggregate([
                {
                    $match: {
                        entityId: new ObjectId(astrologerId),
                        entityType: "ASTROLOGER",
                        category: "EARNINGS",
                        status: "SUCCESS",
                        createdAt: { $gte: todayStart, $lte: todayEnd }
                    }
                },
                {
                    $group: {
                        _id: null,
                        earnings: { $sum: "$amount" },
                        count: { $sum: 1 }
                    }
                }
            ]),

            // 3. Average Rating (Most Accurate)
            Promise.all([
                CallSession.aggregate([
                    {
                        $match: {
                            astrologerId: new ObjectId(astrologerId),
                            status: "COMPLETED",
                            "userRating.stars": { $gte: 1, $lte: 5 }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalStars: { $sum: "$userRating.stars" },
                            totalReviews: { $sum: 1 }
                        }
                    }
                ]),
                ChatSession.aggregate([
                    {
                        $match: {
                            astrologerId: new ObjectId(astrologerId),
                            status: "COMPLETED",
                            "userRating.stars": { $gte: 1, $lte: 5 }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalStars: { $sum: "$userRating.stars" },
                            totalReviews: { $sum: 1 }
                        }
                    }
                ])
            ]),

            // 4. Repeat Clients (Users who consulted >1 time)
            Promise.all([
                CallSession.aggregate([
                    { $match: { astrologerId: new ObjectId(astrologerId), status: "COMPLETED" } },
                    { $group: { _id: "$userId" } },
                    { $group: { _id: null, users: { $push: "$_id" } } }
                ]),
                ChatSession.aggregate([
                    { $match: { astrologerId: new ObjectId(astrologerId), status: "COMPLETED" } },
                    { $group: { _id: "$userId" } },
                    { $group: { _id: null, users: { $push: "$_id" } } }
                ])
            ]).then(([call, chat]) => {
                const allUsers = new Set([...(call[0]?.users || []), ...(chat[0]?.users || [])]);
                return allUsers.size;
            }),

            // 5. Pending Withdrawals
            Payout.aggregate([
                {
                    $match: {
                        astrologerId: new ObjectId(astrologerId),
                        status: { $in: ["REQUESTED", "APPROVED", "PROCESSING"] }
                    }
                },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),

            // 6. Incoming Requests
            Promise.all([
                CallRequest.countDocuments({
                    astrologerId: new ObjectId(astrologerId),
                    status: "PENDING",
                    expiresAt: { $gt: new Date() }
                }),
                ChatRequest.countDocuments({
                    astrologerId: new ObjectId(astrologerId),
                    status: "PENDING",
                    expiresAt: { $gt: new Date() }
                })
            ]),

            // 7. Ongoing Consultation (Call or Chat)
            CallSession.findOne({
                astrologerId: new ObjectId(astrologerId),
                status: { $in: ["CONNECTED", "ACTIVE"] }
            })
                .populate("userId", "name avatar zodiacSign")
                .select("userId callType connectedAt")
                .lean()
                .then(session => session || ChatSession.findOne({
                    astrologerId: new ObjectId(astrologerId),
                    status: "ACTIVE"
                })
                    .populate("userId", "name avatar zodiacSign")
                    .select("userId startedAt")
                    .lean()),

            // 8. Recent Completed Session
            CallSession.findOne({ astrologerId: new ObjectId(astrologerId), status: "COMPLETED" })
                .sort({ endedAt: -1 })
                .populate("userId", "name avatar zodiacSign")
                .select("userId totalDuration endedAt")
                .lean()
                .then(session => session || ChatSession.findOne({
                    astrologerId: new ObjectId(astrologerId),
                    status: "COMPLETED"
                })
                    .sort({ endedAt: -1 })
                    .populate("userId", "name avatar zodiacSign")
                    .select("userId activeDuration endedAt")
                    .lean())
        ]);

        // Calculate Rating
        const callRating = ratingResult[0][0] || { totalStars: 0, totalReviews: 0 };
        const chatRating = ratingResult[1][0] || { totalStars: 0, totalReviews: 0 };
        const totalReviews = callRating.totalReviews + chatRating.totalReviews;
        const totalStars = callRating.totalStars + chatRating.totalStars;
        const averageRating = totalReviews > 0 ? Number((totalStars / totalReviews).toFixed(1)) : 0;

        // Total Consultation Time (All Time) in minutes
        const totalCallMinutes = await CallSession.aggregate([
            { $match: { astrologerId: new ObjectId(astrologerId), status: "COMPLETED" } },
            { $group: { _id: null, total: { $sum: "$billedDuration" } } }
        ]);
        const totalChatMinutes = await ChatSession.aggregate([
            { $match: { astrologerId: new ObjectId(astrologerId), status: "COMPLETED" } },
            { $group: { _id: null, total: { $sum: "$billedDuration" } } }
        ]);
        const totalMinutes = Math.floor(
            ((totalCallMinutes[0]?.total || 0) + (totalChatMinutes[0]?.total || 0)) / 60
        );

        res.status(200).json({
            success: true,
            data: {
                totalEarnings: Math.round(earnings[0]?.total || 0),
                todayEarnings: Math.round(todayStats[0]?.earnings || 0),
                todayConsultations: todayStats[0]?.count || 0,
                totalConsultationTime: totalMinutes,
                averageRating,
                totalReviews,
                repeatClients: repeatClientsCount,
                pendingWithdrawals: Math.round(pendingPayouts[0]?.total || 0),
                incomingRequests: {
                    chat: incomingRequests[1],
                    call: incomingRequests[0],
                    total: incomingRequests[0] + incomingRequests[1]
                },
                ongoingConsultation: ongoingSession ? {
                    user: {
                        name: ongoingSession.userId?.name || "User",
                        avatar: ongoingSession.userId?.avatar,
                        zodiacSign: ongoingSession.userId?.zodiacSign
                    },
                    durationMin: Math.floor(
                        (Date.now() - new Date(ongoingSession.connectedAt || ongoingSession.startedAt)) / 60000
                    ),
                    type: ongoingSession.callType || "CHAT",
                    startTime: ongoingSession.connectedAt || ongoingSession.startedAt
                } : null,
                recentConversation: recentSession ? {
                    user: {
                        name: recentSession.userId?.name || "User",
                        avatar: recentSession.userId?.avatar,
                        zodiacSign: recentSession.userId?.zodiacSign
                    },
                    durationMin: Math.floor((recentSession.totalDuration || recentSession.activeDuration || 0) / 60),
                    endedAt: recentSession.endedAt
                } : null
            }
        });

    } catch (error) {
        console.error("Dashboard API Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data",
            error: error.message
        });
    }
};