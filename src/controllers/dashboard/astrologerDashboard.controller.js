import mongoose from "mongoose";
import { CallSession } from "../../models/calllogs/callSession.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallRequest } from "../../models/calllogs/callRequest.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { Transaction } from "../../models/Wallet/AstroWallet.js";
import { Payout, Wallet } from "../../models/Wallet/AstroWallet.js";
import { Review } from "../../models/review.model.js";

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
        const astrologerIdObj = new ObjectId(astrologerId);

        // Define helper async functions
        const getRepeatClientsCount = async () => {
            const [callGroups, chatGroups] = await Promise.all([
                CallSession.aggregate([
                    { $match: { astrologerId: astrologerIdObj, status: "COMPLETED" } },
                    { $group: { _id: "$userId", count: { $sum: 1 } } }
                ]),
                ChatSession.aggregate([
                    { $match: { astrologerId: astrologerIdObj, status: "COMPLETED" } },
                    { $group: { _id: "$userId", count: { $sum: 1 } } }
                ])
            ]);

            const userCountMap = new Map();
            [...callGroups, ...chatGroups].forEach(group => {
                const userStr = group._id.toString();
                userCountMap.set(userStr, (userCountMap.get(userStr) || 0) + group.count);
            });

            return [...userCountMap.values()].filter(count => count > 1).length;
        };

        const getOngoingSession = async () => {
            const ongoingCall = await CallSession.findOne({
                astrologerId: astrologerIdObj,
                status: { $in: ["CONNECTED", "ACTIVE"] }
            })
                .populate("userId", "fullName avatar zodiacSign")
                .select("callType connectedAt")
                .lean();

            const ongoingChat = await ChatSession.findOne({
                astrologerId: astrologerIdObj,
                status: "ACTIVE"
            })
                .populate("userId", "fullName avatar zodiacSign")
                .select("startedAt")
                .lean();

            return ongoingCall || ongoingChat || null;
        };

        const getRecentSession = async () => {
            const recentCall = await CallSession.findOne({
                astrologerId: astrologerIdObj,
                status: "COMPLETED"
            })
                .sort({ endedAt: -1 })
                .populate("userId", "fullName avatar zodiacSign")
                .select("totalDuration endedAt")
                .lean();

            const recentChat = await ChatSession.findOne({
                astrologerId: astrologerIdObj,
                status: "COMPLETED"
            })
                .sort({ endedAt: -1 })
                .populate("userId", "fullName avatar zodiacSign")
                .select("activeDuration endedAt")
                .lean();

            if (recentCall && recentChat) {
                return recentCall.endedAt > recentChat.endedAt ? recentCall : recentChat;
            }
            return recentCall || recentChat || null;
        };

        const getTotalConsultationTime = async () => {
            const [totalCallMinutes, totalChatMinutes] = await Promise.all([
                CallSession.aggregate([
                    { $match: { astrologerId: astrologerIdObj, status: "COMPLETED" } },
                    { $group: { _id: null, total: { $sum: "$billedDuration" } } }
                ]),
                ChatSession.aggregate([
                    { $match: { astrologerId: astrologerIdObj, status: "COMPLETED" } },
                    { $group: { _id: null, total: { $sum: "$billedDuration" } } }
                ])
            ]);
            const totalSeconds = (totalCallMinutes[0]?.total || 0) + (totalChatMinutes[0]?.total || 0);
            return Math.floor(totalSeconds / 60);
        };

        // Fetch all data concurrently
        const [
            earnings,
            todayStats,
            ratingResult,
            repeatClientsCount,
            pendingPayouts,
            incomingRequests,
            ongoingSession,
            recentSession,
            totalConsultationTimeMinutes
        ] = await Promise.all([
            // 1. Total Earnings (All Time)
            Transaction.aggregate([
                {
                    $match: {
                        entityId: astrologerIdObj,
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
                        entityId: astrologerIdObj,
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

            // 3. Average Rating from Reviews
            Review.aggregate([
                { $match: { astrologerId: astrologerIdObj } },
                {
                    $group: {
                        _id: null,
                        totalStars: { $sum: "$stars" },
                        totalReviews: { $sum: 1 }
                    }
                }
            ]),

            // 4. Repeat Clients Count
            getRepeatClientsCount(),

            // 5. Pending Withdrawals
            Payout.aggregate([
                {
                    $match: {
                        astrologerId: astrologerIdObj,
                        status: { $in: ["REQUESTED", "APPROVED", "PROCESSING"] }
                    }
                },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),

            // 6. Incoming Requests
            Promise.all([
                CallRequest.countDocuments({
                    astrologerId: astrologerIdObj,
                    status: "PENDING",
                    expiresAt: { $gt: new Date() }
                }),
                ChatRequest.countDocuments({
                    astrologerId: astrologerIdObj,
                    status: "PENDING",
                    expiresAt: { $gt: new Date() }
                })
            ]),

            // 7. Ongoing Consultation
            getOngoingSession(),

            // 8. Recent Completed Session
            getRecentSession(),

            // 9. Total Consultation Time
            getTotalConsultationTime()
        ]);

        // Calculate Rating
        const rating = ratingResult[0] || { totalStars: 0, totalReviews: 0 };
        const totalReviews = rating.totalReviews;
        const averageRating = totalReviews > 0 ? Number((rating.totalStars / totalReviews).toFixed(1)) : 0;

        res.status(200).json({
            success: true,
            data: {
                totalEarnings: Math.round(earnings[0]?.total || 0),
                todayEarnings: Math.round(todayStats[0]?.earnings || 0),
                todayConsultations: todayStats[0]?.count || 0,
                totalConsultationTime: totalConsultationTimeMinutes,
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
                        name: ongoingSession.userId?.fullName || "User",
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
                        name: recentSession.userId?.fullName || "User",
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