import mongoose from 'mongoose';
import { CallSession } from '../../models/calllogs/callSession.js';
import { ChatSession } from '../../models/chatapp/chatSession.js';
import { CallRequest } from '../../models/calllogs/callRequest.js';
import { ChatRequest } from '../../models/chatapp/chatRequest.js';
import { Transaction } from '../../models/Wallet/AstroWallet.js';
import { Payout } from '../../models/Wallet/AstroWallet.js';
import { Review } from '../../models/review.model.js';

const { ObjectId } = mongoose.Types;

// Helper: Today in IST
const getISTRange = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds

  // Get current time in IST
  const istNow = new Date(now.getTime() + istOffset);

  // Get start of today in IST (00:00:00)
  const startOfDayIST = new Date(istNow);
  startOfDayIST.setUTCHours(0, 0, 0, 0);

  // Get end of today in IST (23:59:59.999)
  const endOfDayIST = new Date(startOfDayIST);
  endOfDayIST.setUTCHours(23, 59, 59, 999);

  // Convert both to UTC for MongoDB queries
  const todayStart = new Date(startOfDayIST.getTime() - istOffset);
  const todayEnd = new Date(endOfDayIST.getTime() - istOffset);

  // Debug logging (optional)
  console.log('IST Range Debug:', {
    currentTime: now.toISOString(),
    istNow: istNow.toISOString(),
    startOfDayIST: startOfDayIST.toISOString(),
    endOfDayIST: endOfDayIST.toISOString(),
    todayStartUTC: todayStart.toISOString(),
    todayEndUTC: todayEnd.toISOString(),
    durationHours: (todayEnd - todayStart) / (1000 * 60 * 60),
  });

  return { todayStart, todayEnd };
};
export const getAstrologerDashboard = async (req, res) => {
  try {
    const astrologerId = req.user._id;
    if (!astrologerId) return res.status(401).json({ message: 'Unauthorized' });

    const astrologerIdObj = new ObjectId(astrologerId);

    // Get time ranges with debug
    const { todayStart, todayEnd } = getISTRange();

    // 1. First, check if there are any transactions for this astrologer at all
    const allTransactions = await Transaction.find({
      $or: [
        { entityId: astrologerIdObj, entityType: 'ASTROLOGER' },
        { userId: astrologerIdObj, entityType: 'ASTROLOGER' },
      ],
      category: 'EARNINGS',
      status: 'SUCCESS',
    })
      .sort({ createdAt: -1 })
      .limit(10);
 
    // 2. Check if any fall in today's range
    const todayTransactions = allTransactions.filter((tx) => {
      const txDate = new Date(tx.createdAt);
      return txDate >= todayStart && txDate <= todayEnd;
    });

    const manualTodayEarnings = todayTransactions.reduce(
      (sum, tx) => sum + tx.amount,
      0
    );

    // 3. Check sessions to see if there should be earnings
    const todaySessions = await Promise.all([
      CallSession.find({
        astrologerId: astrologerIdObj,
        status: 'COMPLETED',
        endedAt: { $gte: todayStart, $lte: todayEnd },
      }),
      ChatSession.find({
        astrologerId: astrologerIdObj,
        status: 'COMPLETED',
        endedAt: { $gte: todayStart, $lte: todayEnd },
      }),
    ]);

    const [todayCalls, todayChats] = todaySessions;

    // Calculate earnings from sessions
    const callEarnings = todayCalls.reduce(
      (sum, call) => sum + (call.astrologerEarnings || 0),
      0
    );
    const chatEarnings = todayChats.reduce(
      (sum, chat) => sum + (chat.astrologerEarnings || 0),
      0
    );
    const sessionBasedEarnings = callEarnings + chatEarnings;

    const getRepeatClientsCount = async () => {
      const [callGroups, chatGroups] = await Promise.all([
        CallSession.aggregate([
          { $match: { astrologerId: astrologerIdObj, status: 'COMPLETED' } },
          { $group: { _id: '$userId', count: { $sum: 1 } } },
        ]),
        ChatSession.aggregate([
          { $match: { astrologerId: astrologerIdObj, status: 'COMPLETED' } },
          { $group: { _id: '$userId', count: { $sum: 1 } } },
        ]),
      ]);

      const userMap = new Map();
      [...callGroups, ...chatGroups].forEach((g) => {
        if (g._id) {
          const key = g._id.toString();
          userMap.set(key, (userMap.get(key) || 0) + g.count);
        }
      });

      return Array.from(userMap.values()).filter((c) => c > 1).length;
    };

    const getCompletedCounts = async () => {
      const [completedCalls, completedChats] = await Promise.all([
        CallSession.countDocuments({
          astrologerId: astrologerIdObj,
          status: 'COMPLETED',
        }),
        ChatSession.countDocuments({
          astrologerId: astrologerIdObj,
          status: 'COMPLETED',
        }),
      ]);
      return {
        completedCalls,
        completedChats,
        totalCompleted: completedCalls + completedChats,
      };
    };

    const getTotalRequestCounts = async () => {
      const [totalCallRequests, totalChatRequests] = await Promise.all([
        CallRequest.countDocuments({ astrologerId: astrologerIdObj }),
        ChatRequest.countDocuments({ astrologerId: astrologerIdObj }),
      ]);
      return {
        totalCallRequests,
        totalChatRequests,
        totalRequests: totalCallRequests + totalChatRequests,
      };
    };

    const getOngoingSession = async () => {
      const call = await CallSession.findOne({
        astrologerId: astrologerIdObj,
        status: { $in: ['CONNECTED', 'ACTIVE'] },
      })
        .populate('userId', 'fullName phone photo zodiacSign')
        .select('callType connectedAt')
        .lean();

      if (call) return { ...call, type: call.callType };

      const chat = await ChatSession.findOne({
        astrologerId: astrologerIdObj,
        status: 'ACTIVE',
      })
        .populate('userId', 'fullName phone photo zodiacSign')
        .select('startedAt')
        .lean();

      if (chat) return { ...chat, type: 'CHAT' };

      return null;
    };

    const getRecentSession = async () => {
      const [recentCall, recentChat] = await Promise.all([
        CallSession.findOne({
          astrologerId: astrologerIdObj,
          status: 'COMPLETED',
        })
          .sort({ endedAt: -1 })
          .populate('userId', 'fullName phone photo zodiacSign')
          .select('totalDuration billedDuration endedAt')
          .lean(),
        ChatSession.findOne({
          astrologerId: astrologerIdObj,
          status: 'COMPLETED',
        })
          .sort({ endedAt: -1 })
          .populate('userId', 'fullName phone photo zodiacSign')
          .select('activeDuration billedDuration endedAt')
          .lean(),
      ]);

      if (!recentCall && !recentChat) return null;
      if (!recentCall)
        return {
          ...recentChat,
          duration: recentChat.activeDuration || recentChat.billedDuration,
        };
      if (!recentChat)
        return {
          ...recentCall,
          duration: recentCall.totalDuration || recentCall.billedDuration,
        };

      return recentCall.endedAt > recentChat.endedAt
        ? {
            ...recentCall,
            duration: recentCall.totalDuration || recentCall.billedDuration,
          }
        : {
            ...recentChat,
            duration: recentChat.activeDuration || recentChat.billedDuration,
          };
    };

    const getTotalConsultationTime = async () => {
      const [callSec, chatSec] = await Promise.all([
        CallSession.aggregate([
          { $match: { astrologerId: astrologerIdObj, status: 'COMPLETED' } },
          { $group: { _id: null, total: { $sum: '$billedDuration' } } },
        ]),
        ChatSession.aggregate([
          { $match: { astrologerId: astrologerIdObj, status: 'COMPLETED' } },
          { $group: { _id: null, total: { $sum: '$billedDuration' } } },
        ]),
      ]);
      const totalSeconds = (callSec[0]?.total || 0) + (chatSec[0]?.total || 0);
      return Math.floor(totalSeconds / 60);
    };

    // Helper function to get display name
    const getDisplayName = (user) => {
      if (!user) return 'Unknown';
      return user.fullName || 'User';
    };

    // 4. Now run your parallel queries
    const [
      allTimeEarningsAgg,
      todayStatsAgg,
      reviewStats,
      repeatClients,
      pendingWithdrawals,
      incomingCounts,
      completedCounts,
      totalRequestCounts,
      ongoingRaw,
      recentRaw,
      totalMinutes,
    ] = await Promise.all([
      // All time earnings
      await Transaction.aggregate([
        {
          $match: {
            userId: astrologerIdObj, // ✅ Use userId like in getLifetimeEarnings
            type: 'CREDIT',
            status: 'SUCCESS',
            category: {
              $in: ['EARNINGS', 'CALL_SESSION', 'CHAT_SESSION', 'LIVE'],
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
          },
        },
      ]),

      // Today's stats
      Transaction.aggregate([
        {
          $match: {
            $or: [
              {
                entityId: astrologerIdObj,
                entityType: 'ASTROLOGER',
                category: 'EARNINGS',
                status: 'SUCCESS',
              },
              {
                userId: astrologerIdObj,
                entityType: 'ASTROLOGER',
                category: 'EARNINGS',
                status: 'SUCCESS',
              },
            ],
            createdAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        {
          $group: {
            _id: null,
            earnings: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),

      // ... rest of your existing queries
      Review.aggregate([
        { $match: { astrologerId: astrologerIdObj } },
        {
          $group: {
            _id: null,
            totalStars: { $sum: '$stars' },
            totalReviews: { $sum: 1 },
          },
        },
      ]),
      getRepeatClientsCount(),
      Payout.aggregate([
        {
          $match: {
            astrologerId: astrologerIdObj,
            status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Promise.all([
        CallRequest.countDocuments({
          astrologerId: astrologerIdObj,
          status: 'PENDING',
          expiresAt: { $gt: new Date() },
        }),
        ChatRequest.countDocuments({
          astrologerId: astrologerIdObj,
          status: 'PENDING',
          expiresAt: { $gt: new Date() },
        }),
      ]),
      getCompletedCounts(),
      getTotalRequestCounts(),
      getOngoingSession(),
      getRecentSession(),
      getTotalConsultationTime(),
    ]);

    // Determine which earnings value to use
    const todayEarningsFromTransactions = todayStatsAgg[0]?.earnings || 0;
    const todayEarningsToUse =
      todayEarningsFromTransactions > 0
        ? todayEarningsFromTransactions
        : sessionBasedEarnings;

    const todayConsultationsFromTransactions = todayStatsAgg[0]?.count || 0;
    const todayConsultationsToUse =
      todayConsultationsFromTransactions > 0
        ? todayConsultationsFromTransactions
        : todayCalls.length + todayChats.length;

    // Process the rest of your data...
    const reviewData = reviewStats[0] || { totalStars: 0, totalReviews: 0 };
    const averageRating =
      reviewData.totalReviews > 0
        ? Number((reviewData.totalStars / reviewData.totalReviews).toFixed(1))
        : 0;

    const [pendingCallRequests, pendingChatRequests] = incomingCounts;

    const ongoingConsultation = ongoingRaw
      ? {
          user: {
            name: getDisplayName(ongoingRaw.userId),
            avatar: ongoingRaw.userId?.photo || null,
            zodiacSign: ongoingRaw.userId?.zodiacSign || null,
          },
          durationMin: Math.floor(
            (Date.now() -
              new Date(ongoingRaw.connectedAt || ongoingRaw.startedAt)) /
              60000
          ),
          type: ongoingRaw.type,
          startTime: ongoingRaw.connectedAt || ongoingRaw.startedAt,
        }
      : null;

    const recentConversation = recentRaw
      ? {
          user: {
            name: getDisplayName(recentRaw.userId),
            avatar: recentRaw.userId?.photo || null,
            zodiacSign: recentRaw.userId?.zodiacSign || null,
          },
          durationMin: Math.floor((recentRaw.duration || 0) / 60),
          endedAt: recentRaw.endedAt,
        }
      : null;

    res.status(200).json({
      success: true,
      data: {
        totalEarnings: Math.round(allTimeEarningsAgg[0]?.total || 0),
        todayEarnings: Math.round(todayEarningsToUse),
        todayConsultations: todayConsultationsToUse,
        totalConsultationTime: totalMinutes,
        averageRating,
        totalReviews: reviewData.totalReviews,
        repeatClients: repeatClients,
        pendingWithdrawals: Math.round(pendingWithdrawals[0]?.total || 0),
        incomingRequests: {
          call: pendingCallRequests,
          chat: pendingChatRequests,
          total: pendingCallRequests + pendingChatRequests,
        },
        completedSessions: {
          calls: completedCounts.completedCalls,
          chats: completedCounts.completedChats,
          total: completedCounts.totalCompleted,
        },
        totalRequestsReceived: {
          callRequests: totalRequestCounts.totalCallRequests,
          chatRequests: totalRequestCounts.totalChatRequests,
          total: totalRequestCounts.totalRequests,
        },
        ongoingConsultation,
        recentConversation,
      },
    });
  } catch (error) {
    console.error('Dashboard API Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message,
    });
  }
};
