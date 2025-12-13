import mongoose from "mongoose";

import { Transaction, Payout } from "../../models/Wallet/AstroWallet.js";
import { Review } from "../../models/review.model.js";
import { CallRequest } from "../../models/calllogs/callRequest.js";
import { CallSession } from "../../models/calllogs/callSession.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";




const { ObjectId } = mongoose.Types;

// Helper: Today's date range in IST
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

// Helper: Get last 7 days range
const getLast7DaysRange = () => {
    const { todayStart } = getISTRange();
    const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { startDate: sevenDaysAgo, endDate: todayStart };
};

export const getAstrologerDashboard = async (req, res) => {
    try {
        const astrologerId = req.user._id;
        if (!astrologerId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const { todayStart, todayEnd } = getISTRange();
        const astroObjectId = new ObjectId(astrologerId);

        // Execute all database queries in parallel for performance
        const [
            totalEarningsData,
            todayEarningsData,
            totalConsultationTime,
            ratingStats,
            reviewStats,
            repeatClientsData,
            pendingPayoutsData,
            incomingRequestsData,
            todaySessionsData,
            recentCallSessions,
            recentChatSessions,
            activeCallSession,
            activeChatSession
        ] = await Promise.all([
            // 1. TOTAL EARNINGS (All Time)
            Transaction.aggregate([
                {
                    $match: {
                        entityId: astroObjectId,
                        entityType: "ASTROLOGER",
                        category: "EARNINGS",
                        status: "SUCCESS"
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalEarnings: { $sum: "$amount" },
                        totalSessions: { $sum: 1 }
                    }
                }
            ]),

            // 2. TODAY'S EARNINGS
            Transaction.aggregate([
                {
                    $match: {
                        entityId: astroObjectId,
                        entityType: "ASTROLOGER",
                        category: "EARNINGS",
                        status: "SUCCESS",
                        createdAt: { $gte: todayStart, $lte: todayEnd }
                    }
                },
                {
                    $group: {
                        _id: null,
                        todayEarnings: { $sum: "$amount" },
                        todaySessions: { $sum: 1 }
                    }
                }
            ]),

            // 3. TOTAL CONSULTATION TIME (in minutes)
            Promise.all([
                CallSession.aggregate([
                    {
                        $match: {
                            astrologerId: astroObjectId,
                            status: "COMPLETED"
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalDuration: { $sum: "$billedDuration" }
                        }
                    }
                ]),
                ChatSession.aggregate([
                    {
                        $match: {
                            astrologerId: astroObjectId,
                            status: "COMPLETED"
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalDuration: { $sum: "$billedDuration" }
                        }
                    }
                ])
            ]),

            // 4. AVERAGE RATING
            Review.aggregate([
                {
                    $match: {
                        astrologerId: astroObjectId
                    }
                },
                {
                    $group: {
                        _id: null,
                        averageRating: { $avg: "$stars" },
                        totalReviews: { $sum: 1 },
                        ratingDistribution: {
                            $push: "$stars"
                        }
                    }
                }
            ]),

            // 5. REVIEW STATS (using Review model)
            Review.aggregate([
                {
                    $match: {
                        astrologerId: astroObjectId
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalReviews: { $sum: 1 },
                        fiveStar: {
                            $sum: { $cond: [{ $eq: ["$stars", 5] }, 1, 0] }
                        },
                        fourStar: {
                            $sum: { $cond: [{ $eq: ["$stars", 4] }, 1, 0] }
                        },
                        threeStar: {
                            $sum: { $cond: [{ $eq: ["$stars", 3] }, 1, 0] }
                        },
                        twoStar: {
                            $sum: { $cond: [{ $eq: ["$stars", 2] }, 1, 0] }
                        },
                        oneStar: {
                            $sum: { $cond: [{ $eq: ["$stars", 1] }, 1, 0] }
                        }
                    }
                }
            ]),

            // 6. REPEAT CLIENTS
            Promise.all([
                CallSession.aggregate([
                    {
                        $match: {
                            astrologerId: astroObjectId,
                            status: "COMPLETED"
                        }
                    },
                    {
                        $group: {
                            _id: "$userId",
                            sessions: { $sum: 1 }
                        }
                    },
                    {
                        $match: {
                            sessions: { $gt: 1 }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            repeatClients: { $sum: 1 }
                        }
                    }
                ]),
                ChatSession.aggregate([
                    {
                        $match: {
                            astrologerId: astroObjectId,
                            status: "COMPLETED"
                        }
                    },
                    {
                        $group: {
                            _id: "$userId",
                            sessions: { $sum: 1 }
                        }
                    },
                    {
                        $match: {
                            sessions: { $gt: 1 }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            repeatClients: { $sum: 1 }
                        }
                    }
                ])
            ]),

            // 7. PENDING WITHDRAWALS
            Payout.aggregate([
                {
                    $match: {
                        astrologerId: astroObjectId,
                        status: { $in: ["REQUESTED", "APPROVED", "PROCESSING"] }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalPending: { $sum: "$amount" }
                    }
                }
            ]),

            // 8. INCOMING REQUESTS
            Promise.all([
                CallRequest.countDocuments({
                    astrologerId: astrologerId,
                    status: "PENDING",
                    expiresAt: { $gt: new Date() }
                }),
                ChatRequest.countDocuments({
                    astrologerId: astrologerId,
                    status: "PENDING",
                    expiresAt: { $gt: new Date() }
                })
            ]),

            // 9. TODAY'S SESSIONS
            Promise.all([
                CallSession.countDocuments({
                    astrologerId: astrologerId,
                    status: "COMPLETED",
                    endedAt: { $gte: todayStart, $lte: todayEnd }
                }),
                ChatSession.countDocuments({
                    astrologerId: astrologerId,
                    status: "COMPLETED",
                    endedAt: { $gte: todayStart, $lte: todayEnd }
                })
            ]),

            // 10. RECENT 5 CALL SESSIONS
            CallSession.find({
                astrologerId: astrologerId,
                status: "COMPLETED"
            })
                .sort({ endedAt: -1 })
                .limit(5)
                .populate("userId", "fullName phone profileImage")
                .select("sessionId userId callType totalDuration endedAt userRating totalCost")
                .lean(),

            // 11. RECENT 5 CHAT SESSIONS
            ChatSession.find({
                astrologerId: astrologerId,
                status: "COMPLETED"
            })
                .sort({ endedAt: -1 })
                .limit(5)
                .populate("userId", "fullName phone profileImage")
                .select("sessionId userId totalDuration endedAt userRating totalCost")
                .lean(),

            // 12. ACTIVE CALL SESSION
            CallSession.findOne({
                astrologerId: astrologerId,
                status: { $in: ["CONNECTED", "ACTIVE"] }
            })
                .populate("userId", "fullName phone profileImage")
                .select("sessionId userId callType connectedAt totalDuration")
                .lean(),

            // 13. ACTIVE CHAT SESSION
            ChatSession.findOne({
                astrologerId: astrologerId,
                status: "ACTIVE"
            })
                .populate("userId", "fullName phone profileImage")
                .select("sessionId userId startedAt activeDuration")
                .lean()
        ]);

        // Process and format the data
        const totalEarnings = totalEarningsData[0]?.totalEarnings || 0;
        const totalSessions = totalEarningsData[0]?.totalSessions || 0;

        const todayEarnings = todayEarningsData[0]?.todayEarnings || 0;

        const callDuration = totalConsultationTime[0][0]?.totalDuration || 0;
        const chatDuration = totalConsultationTime[1][0]?.totalDuration || 0;
        const totalConsultationMinutes = Math.floor((callDuration + chatDuration) / 60);

        const ratingData = ratingStats[0] || {};
        const averageRating = ratingData.averageRating ?
            Number(ratingData.averageRating.toFixed(1)) : 0;

        const reviewData = reviewStats[0] || {};
        const totalReviews = reviewData.totalReviews || 0;

        const repeatClientsCall = repeatClientsData[0][0]?.repeatClients || 0;
        const repeatClientsChat = repeatClientsData[1][0]?.repeatClients || 0;
        const repeatClients = repeatClientsCall + repeatClientsChat;

        const pendingWithdrawals = pendingPayoutsData[0]?.totalPending || 0;

        const incomingCallRequests = incomingRequestsData[0] || 0;
        const incomingChatRequests = incomingRequestsData[1] || 0;
        const totalIncomingRequests = incomingCallRequests + incomingChatRequests;

        const todayCallSessions = todaySessionsData[0] || 0;
        const todayChatSessions = todaySessionsData[1] || 0;
        const totalTodaySessions = todayCallSessions + todayChatSessions;

        // Format recent sessions
        const formatRecentSession = (session, type) => ({
            id: session.sessionId,
            type: type,
            user: {
                name: session.userId?.fullName || "User",
                phone: session.userId?.phone,
                profileImage: session.userId?.profileImage
            },
            duration: Math.floor((type === "CALL" ? session.totalDuration : session.activeDuration) / 60),
            rating: session.userRating?.stars || null,
            cost: session.totalCost || 0,
            endedAt: session.endedAt,
            timeAgo: getTimeAgo(session.endedAt)
        });

        const recentSessions = [
            ...recentCallSessions.map(session => formatRecentSession(session, "CALL")),
            ...recentChatSessions.map(session => formatRecentSession(session, "CHAT"))
        ].sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))
            .slice(0, 10); // Get top 10 most recent

        // Active consultation
        const activeConsultation = activeCallSession || activeChatSession;
        let activeSessionData = null;

        if (activeConsultation) {
            const isCall = activeCallSession !== null;
            const startTime = isCall ?
                activeCallSession.connectedAt :
                activeChatSession.startedAt;
            const duration = isCall ?
                activeCallSession.totalDuration :
                activeChatSession.activeDuration;

            activeSessionData = {
                id: activeConsultation.sessionId,
                type: isCall ? "CALL" : "CHAT",
                user: {
                    name: activeConsultation.userId?.fullName || "User",
                    phone: activeConsultation.userId?.phone,
                    profileImage: activeConsultation.userId?.profileImage
                },
                duration: Math.floor(duration / 60),
                startTime: startTime,
                elapsedTime: Math.floor((Date.now() - new Date(startTime).getTime()) / 60000)
            };
        }

        // Response data
        const dashboardData = {
            summary: {
                totalEarnings: Math.round(totalEarnings),
                totalConsultationTime: totalConsultationMinutes,
                averageRating,
                totalReviews,
                repeatClients,
                pendingWithdrawals: Math.round(pendingWithdrawals)
            },
            today: {
                earnings: Math.round(todayEarnings),
                sessions: totalTodaySessions,
                liveConsultation: activeSessionData ? 1 : 0
            },
            requests: {
                incoming: {
                    call: incomingCallRequests,
                    chat: incomingChatRequests,
                    total: totalIncomingRequests
                }
            },
            recentSessions: recentSessions,
            activeConsultation: activeSessionData,
            ratingDistribution: {
                fiveStar: reviewData.fiveStar || 0,
                fourStar: reviewData.fourStar || 0,
                threeStar: reviewData.threeStar || 0,
                twoStar: reviewData.twoStar || 0,
                oneStar: reviewData.oneStar || 0
            }
        };

        res.status(200).json({
            success: true,
            message: "Dashboard data fetched successfully",
            data: dashboardData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Dashboard API Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Helper function to get time ago
function getTimeAgo(date) {
    if (!date) return "N/A";

    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return past.toLocaleDateString();
}

// Additional endpoint for dashboard stats over time (last 7 days)
export const getDashboardStats = async (req, res) => {
    try {
        const astrologerId = req.user._id;
        const { startDate, endDate } = getLast7DaysRange();

        const astroObjectId = new ObjectId(astrologerId);

        // Get earnings per day for last 7 days
        const earningsData = await Transaction.aggregate([
            {
                $match: {
                    entityId: astroObjectId,
                    entityType: "ASTROLOGER",
                    category: "EARNINGS",
                    status: "SUCCESS",
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt",
                            timezone: "+05:30" // IST
                        }
                    },
                    earnings: { $sum: "$amount" },
                    sessions: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Get session types distribution
        const sessionTypesData = await Promise.all([
            CallSession.countDocuments({
                astrologerId: astrologerId,
                status: "COMPLETED",
                endedAt: { $gte: startDate, $lte: endDate }
            }),
            ChatSession.countDocuments({
                astrologerId: astrologerId,
                status: "COMPLETED",
                endedAt: { $gte: startDate, $lte: endDate }
            })
        ]);

        res.status(200).json({
            success: true,
            data: {
                earningsChart: earningsData,
                sessionTypes: {
                    call: sessionTypesData[0],
                    chat: sessionTypesData[1],
                    total: sessionTypesData[0] + sessionTypesData[1]
                }
            }
        });

    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard stats"
        });
    }
};