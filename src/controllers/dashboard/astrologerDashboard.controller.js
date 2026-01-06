import mongoose from "mongoose";
import { CallSession } from "../../models/calllogs/callSession.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { CallRequest } from "../../models/calllogs/callRequest.js";
import { ChatRequest } from "../../models/chatapp/chatRequest.js";
import { Transaction } from "../../models/Wallet/AstroWallet.js";
import { Payout } from "../../models/Wallet/AstroWallet.js";
import { Review } from "../../models/review.model.js";

const { ObjectId } = mongoose.Types;

// Helper: Today in IST
// Fixed: Today in IST (starting from 00:00:00 IST)
const getISTRange = () => {
    const now = new Date();
    const istOffsetMinutes = 5.5 * 60; // IST is UTC+5:30
    const istOffsetMs = istOffsetMinutes * 60 * 1000;

    // Get current time in IST
    const istNow = new Date(now.getTime() + istOffsetMs);

    // Set to beginning of day in IST (00:00:00)
    const startOfDayIST = new Date(istNow);
    startOfDayIST.setUTCHours(0, 0, 0, 0);

    // Convert IST start of day back to UTC
    const startUTC = new Date(startOfDayIST.getTime() - istOffsetMs);

    // End of day in IST (23:59:59.999)
    const endOfDayIST = new Date(startOfDayIST.getTime() + 24 * 60 * 60 * 1000 - 1);
    const endUTC = new Date(endOfDayIST.getTime() - istOffsetMs);

    return { todayStart: startUTC, todayEnd: endUTC };
};
// Smart display name: fullName → last 10 digits of phone → "User"
const getDisplayName = (user) => {
    if (user?.fullName && user.fullName.trim()) return user.fullName.trim();
    if (user?.phone) {
        const digits = user.phone.replace(/\D/g, '');
        return digits.slice(-10) || "User";
    }
    return "User";
};

export const getAstrologerDashboard = async (req, res) => {
    try {
        const astrologerId = req.user._id;
        if (!astrologerId) return res.status(401).json({ message: "Unauthorized" });

        c// Get current date in IST
        const now = new Date();
        const startOfTodayIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        startOfTodayIST.setHours(0, 0, 0, 0);

        const endOfTodayIST = new Date(startOfTodayIST);
        endOfTodayIST.setHours(23, 59, 59, 999);

        // Convert back to UTC for MongoDB query
        const todayStart = new Date(startOfTodayIST.toISOString());
        const todayEnd = new Date(endOfTodayIST.toISOString());

        const astrologerIdObj = new ObjectId(astrologerId);

        // 1. Repeat Clients Count
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

            const userMap = new Map();
            [...callGroups, ...chatGroups].forEach(g => {
                if (g._id) {
                    const key = g._id.toString();
                    userMap.set(key, (userMap.get(key) || 0) + g.count);
                }
            });

            return Array.from(userMap.values()).filter(c => c > 1).length;
        };

        // 2. Total Completed Counts (All Time)
        const getCompletedCounts = async () => {
            const [completedCalls, completedChats] = await Promise.all([
                CallSession.countDocuments({ astrologerId: astrologerIdObj, status: "COMPLETED" }),
                ChatSession.countDocuments({ astrologerId: astrologerIdObj, status: "COMPLETED" })
            ]);
            return { completedCalls, completedChats, totalCompleted: completedCalls + completedChats };
        };

        // 3. Total Request Counts (All Time - regardless of status)
        const getTotalRequestCounts = async () => {
            const [totalCallRequests, totalChatRequests] = await Promise.all([
                CallRequest.countDocuments({ astrologerId: astrologerIdObj }),
                ChatRequest.countDocuments({ astrologerId: astrologerIdObj })
            ]);
            return { totalCallRequests, totalChatRequests, totalRequests: totalCallRequests + totalChatRequests };
        };

        // 4. Ongoing Session
        const getOngoingSession = async () => {
            const call = await CallSession.findOne({
                astrologerId: astrologerIdObj,
                status: { $in: ["CONNECTED", "ACTIVE"] }
            })
                .populate("userId", "fullName phone photo zodiacSign")
                .select("callType connectedAt")
                .lean();

            if (call) return { ...call, type: call.callType };

            const chat = await ChatSession.findOne({
                astrologerId: astrologerIdObj,
                status: "ACTIVE"
            })
                .populate("userId", "fullName phone photo zodiacSign")
                .select("startedAt")
                .lean();

            if (chat) return { ...chat, type: "CHAT" };

            return null;
        };

        // 5. Recent Completed Session
        const getRecentSession = async () => {
            const [recentCall, recentChat] = await Promise.all([
                CallSession.findOne({ astrologerId: astrologerIdObj, status: "COMPLETED" })
                    .sort({ endedAt: -1 })
                    .populate("userId", "fullName phone photo zodiacSign")
                    .select("totalDuration billedDuration endedAt")
                    .lean(),
                ChatSession.findOne({ astrologerId: astrologerIdObj, status: "COMPLETED" })
                    .sort({ endedAt: -1 })
                    .populate("userId", "fullName phone photo zodiacSign")
                    .select("activeDuration billedDuration endedAt")
                    .lean()
            ]);

            if (!recentCall && !recentChat) return null;
            if (!recentCall) return { ...recentChat, duration: recentChat.activeDuration || recentChat.billedDuration };
            if (!recentChat) return { ...recentCall, duration: recentCall.totalDuration || recentCall.billedDuration };

            return recentCall.endedAt > recentChat.endedAt
                ? { ...recentCall, duration: recentCall.totalDuration || recentCall.billedDuration }
                : { ...recentChat, duration: recentChat.activeDuration || recentChat.billedDuration };
        };

        // 6. Total Consultation Time (minutes)
        const getTotalConsultationTime = async () => {
            const [callSec, chatSec] = await Promise.all([
                CallSession.aggregate([
                    { $match: { astrologerId: astrologerIdObj, status: "COMPLETED" } },
                    { $group: { _id: null, total: { $sum: "$billedDuration" } } }
                ]),
                ChatSession.aggregate([
                    { $match: { astrologerId: astrologerIdObj, status: "COMPLETED" } },
                    { $group: { _id: null, total: { $sum: "$billedDuration" } } }
                ])
            ]);
            const totalSeconds = (callSec[0]?.total || 0) + (chatSec[0]?.total || 0);
            return Math.floor(totalSeconds / 60);
        };

        // Parallel fetches
        const [
            allTimeEarnings,
            todayStats,
            reviewStats,
            repeatClients,
            pendingWithdrawals,
            incomingCounts,
            completedCounts,
            totalRequestCounts,
            ongoingRaw,
            recentRaw,
            totalMinutes
        ] = await Promise.all([
            Transaction.aggregate([
                { $match: { entityId: astrologerIdObj, entityType: "ASTROLOGER", category: "EARNINGS", status: "SUCCESS" } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Transaction.aggregate([
                { $match: { entityId: astrologerIdObj, entityType: "ASTROLOGER", category: "EARNINGS", status: "SUCCESS", createdAt: { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: null, earnings: { $sum: "$amount" }, count: { $sum: 1 } } }
            ]),
            Review.aggregate([
                { $match: { astrologerId: astrologerIdObj } },
                { $group: { _id: null, totalStars: { $sum: "$stars" }, totalReviews: { $sum: 1 } } }
            ]),
            getRepeatClientsCount(),
            Payout.aggregate([
                { $match: { astrologerId: astrologerIdObj, status: { $in: ["REQUESTED", "APPROVED", "PROCESSING"] } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
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
            getCompletedCounts(),
            getTotalRequestCounts(),
            getOngoingSession(),
            getRecentSession(),
            getTotalConsultationTime()
        ]);

        // Process results
        const reviewData = reviewStats[0] || { totalStars: 0, totalReviews: 0 };
        const averageRating = reviewData.totalReviews > 0
            ? Number((reviewData.totalStars / reviewData.totalReviews).toFixed(1))
            : 0;

        const [pendingCallRequests, pendingChatRequests] = incomingCounts;

        const ongoingConsultation = ongoingRaw ? {
            user: {
                name: getDisplayName(ongoingRaw.userId),
                avatar: ongoingRaw.userId?.photo || null,
                zodiacSign: ongoingRaw.userId?.zodiacSign || null
            },
            durationMin: Math.floor((Date.now() - new Date(ongoingRaw.connectedAt || ongoingRaw.startedAt)) / 60000),
            type: ongoingRaw.type,
            startTime: ongoingRaw.connectedAt || ongoingRaw.startedAt
        } : null;

        const recentConversation = recentRaw ? {
            user: {
                name: getDisplayName(recentRaw.userId),
                avatar: recentRaw.userId?.photo || null,
                zodiacSign: recentRaw.userId?.zodiacSign || null
            },
            durationMin: Math.floor((recentRaw.duration || 0) / 60),
            endedAt: recentRaw.endedAt
        } : null;

        res.status(200).json({
            success: true,
            data: {
                totalEarnings: Math.round(allTimeEarnings[0]?.total || 0),
                todayEarnings: Math.round(todayStats[0]?.earnings || 0),
                todayConsultations: todayStats[0]?.count || 0,
                totalConsultationTime: totalMinutes,
                averageRating,
                totalReviews: reviewData.totalReviews,
                repeatClients: repeatClients,
                pendingWithdrawals: Math.round(pendingWithdrawals[0]?.total || 0),
                incomingRequests: {  // Live pending requests (waiting for accept/reject)
                    call: pendingCallRequests,
                    chat: pendingChatRequests,
                    total: pendingCallRequests + pendingChatRequests
                },
                completedSessions: {  // All-time completed calls & chats
                    calls: completedCounts.completedCalls,
                    chats: completedCounts.completedChats,
                    total: completedCounts.totalCompleted
                },
                totalRequestsReceived: {  // All-time requests (all statuses)
                    callRequests: totalRequestCounts.totalCallRequests,
                    chatRequests: totalRequestCounts.totalChatRequests,
                    total: totalRequestCounts.totalRequests
                },
                ongoingConsultation,
                recentConversation
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