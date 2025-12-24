import { startOfDay, endOfDay, subDays } from 'date-fns';
import { User } from '../../models/user.js';
import { Message } from '../../models/chatapp/message.js';
import { Astrologer } from '../../models/astrologer.js';
import { CallSession } from '../../models/calllogs/callSession.js';
import { RechargeHistory } from '../../models/Wallet/AstroWallet.js';
import { ChatSession } from '../../models/chatapp/chatSession.js';

// Helper: Get start/end of today (IST)
const getTodayRange = () => {
  const now = new Date();
  const start = startOfDay(now);
  const end = endOfDay(now);
  return { start, end };
};

// Helper: Get last 7 days for charts
const getLast7Days = () => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const dateStr = date.toISOString().split('T')[0]; // "2025-12-18"
    days.push({
      name: date.toLocaleDateString('en-US', { weekday: 'short' }),
      date,
      dateStr, // ← ADD THIS
    });
  }
  return days;
};

export const getDashboardStats = async (req, res) => {
  try {
    const today = getTodayRange();

    // 1. Total Users
    const totalUsers = await User.countDocuments({ role: 'user' });

    // 2. Astrologers Online
    const onlineAstrologers = await User.countDocuments({
      role: 'astrologer',
      isOnline: true,
      isSuspend: false,
      accountStatus: 'approved',
    });

    // 3. Calls Today
    const callsToday = await CallSession.countDocuments({
      status: 'COMPLETED',
      endedAt: { $gte: today.start, $lte: today.end },
    });
    // 4. Revenue Today (only completed calls)
    const todayRecharges = await RechargeHistory.aggregate([
      {
        $match: {
          status: 'SUCCESS',
          $or: [
            { completedAt: { $gte: today.start, $lte: today.end } },
            { processedAt: { $gte: today.start, $lte: today.end } },
            { updatedAt: { $gte: today.start, $lte: today.end } },
            { createdAt: { $gte: today.start, $lte: today.end } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$requestedAmount' },
        },
      },
    ]);
    const revenueToday = todayRecharges[0]?.total || 0;
    // 5. Chats Today (messages sent today)
    const chatsToday = await ChatSession.countDocuments({
      createdAt: { $gte: today.start, $lte: today.end },
    });

    // 6. Pending Approvals (astrologers pending approval)
    const pendingApprovals = await Astrologer.countDocuments({
      astrologerApproved: false,
      accountStatus: 'pending',
    });

    // 7. Avg Response Time (last 60 messages, avg time between user msg & first astrologer reply)
    const responseTimes = await Message.aggregate([
    // Step 1: Get last 500 messages sorted by time
    { $sort: { createdAt: -1 } },
    { $limit: 500 },

    // Step 2: Group by chat to process conversations
    {
        $group: {
        _id: "$chat",
        messages: {
            $push: {
            sender: "$sender",
            createdAt: "$createdAt",
            type: "$type",
            },
        },
        },
    },

    // Step 3: For each chat, find user → astrologer response times
    {
        $project: {
        responseTimes: {
            $reduce: {
            input: "$messages",
            initialValue: { lastUserTime: null, responses: [] },
            in: {
                $cond: {
                if: { $eq: ["$$this.sender.role", "user"] },
                then: {
                    lastUserTime: "$$this.createdAt",
                    responses: "$$value.responses",
                },
                else: {
                    $cond: {
                    if: {
                        $and: [
                        { $eq: ["$$this.sender.role", "astrologer"] },
                        { $ne: ["$$value.lastUserTime", null] },
                        { $gt: ["$$this.createdAt", "$$value.lastUserTime"] },
                        ],
                    },
                    then: {
                        lastUserTime: "$$value.lastUserTime",
                        responses: {
                        $concatArrays: [
                            "$$value.responses",
                            [{ $subtract: ["$$this.createdAt", "$$value.lastUserTime"] }],
                        ],
                        },
                    },
                    else: {
                        lastUserTime: "$$value.lastUserTime",
                        responses: "$$value.responses",
                    },
                    },
                },
                },
            },
            },
        },
        },
    },

    // Step 4: Unwind the response times array
    { $unwind: { path: "$responseTimes.responses", preserveNullAndEmptyArrays: true } },

    // Step 5: Filter only valid positive response times
    { $match: { "responseTimes.responses": { $gt: 0 } } },

    // Step 6: Calculate average in milliseconds, then convert to minutes
    {
        $group: {
        _id: null,
        totalResponseTime: { $sum: "$responseTimes.responses" },
        count: { $sum: 1 },
        },
    },
    {
        $project: {
        avgResponseSeconds: { $divide: ["$totalResponseTime", "$count"] },
        avgResponseMinutes: {
            $round: [{ $divide: [{ $divide: ["$totalResponseTime", "$count"] }, 60000] }, 1],
        },
        },
    },
    ]);

    const avgResponseMin = responseTimes[0]?.avgResponseMinutes || 0;

    // 8. Active Sessions (active calls + active chats)
    const activeCalls = await CallSession.countDocuments({
      status: 'CONNECTED',
      endTime: null,
    });
    const activeChats = await ChatSession.countDocuments({}); // or use socket.io active users if you have it
    const activeSessions = activeCalls + activeChats; // simplistic

    // Weekly Revenue & User Growth
    const last7Days = getLast7Days();

    // Revenue per day
    const weeklyRechargeData = await RechargeHistory.aggregate([
      {
        $match: {
          status: 'SUCCESS',
          $or: [
            { completedAt: { $gte: subDays(new Date(), 6) } },
            { processedAt: { $gte: subDays(new Date(), 6) } },
            { updatedAt: { $gte: subDays(new Date(), 6) } },
            { createdAt: { $gte: subDays(new Date(), 6) } },
          ],
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: {
                $cond: [
                  { $ifNull: ['$completedAt', false] },
                  '$completedAt',
                  {
                    $cond: [
                      { $ifNull: ['$processedAt', false] },
                      '$processedAt',
                      {
                        $cond: [
                          { $ifNull: ['$updatedAt', false] },
                          '$updatedAt',
                          '$createdAt',
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          revenue: { $sum: '$requestedAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const revenueData = last7Days.map((day) => {
      const found = weeklyRechargeData.find((r) => r._id === day.dateStr);
      return { name: day.name, revenue: found?.revenue || 0 };
    });

    // User Growth (new users per day)
    const userGrowth = await User.aggregate([
      {
        $match: {
          role: 'user',
          createdAt: { $gte: subDays(new Date(), 6) },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const growthData = last7Days.map((day) => {
      const found = userGrowth.find((r) => r._id === day.date.toISOString().split('T')[0]);
      return { name: day.name, revenue: found?.count || 0 }; // reusing "revenue" key for chart
    });

    // Live Astrologers (online + approved)

    const liveAstrologers = await User.aggregate([
    {
        $match: {
        role: 'astrologer',
        isOnline: true,
        isSuspend: false,
        },
    },
    {
        $lookup: {
        from: 'astrologers',
        localField: '_id',
        foreignField: 'userId',
        as: 'astroDetails',
        },
    },
    { $unwind: { path: '$astroDetails', preserveNullAndEmptyArrays: true } },
    {
        $lookup: {
        from: 'reviews',
        localField: '_id',
        foreignField: 'astrologerId',
        as: 'reviews',
        },
    },
    // Lookup today's calls count
    {
    $addFields: {
      // Calculate average rating
      avgRating: {
        $cond: {
          if: { $eq: [{ $size: '$reviews' }, 0] },
          then: 0,
          else: { $round: [{ $avg: '$reviews.stars' }, 1] },
        },
      },
      totalReviews: { $size: '$reviews' },
      calls: 0, // Will be updated below
    },
  },
    {
        $lookup: {
        from: 'calls',
        let: { astroId: '$_id' },
        pipeline: [
            {
            $match: {
                $expr: {
                $and: [
                    { $eq: ['$astrologerId', '$$astroId'] },
                    { $gte: ['$startTime', new Date(new Date().setHours(0, 0, 0, 0))] },
                    { $lte: ['$startTime', new Date(new Date().setHours(23, 59, 59, 999))] },
                    { $in: ['$status', ['CONNECTED', 'COMPLETED']] },
                ],
                },
            },
            },
            { $count: 'total' },
        ],
        as: 'todayCalls',
        },
    },
    {
        $addFields: {
        calls: { $ifNull: [{ $arrayElemAt: ['$todayCalls.total', 0] }, 0] },
        },
    },
{
    $project: {
      _id: 1,
      fullName: 1,                       // From User
      specialty: { $arrayElemAt: ['$astroDetails.specialization', 0] },
      rank: '$astroDetails.rank',    // From Astrologer
      avgRating: 1,
      totalReviews: 1,
      calls: 1,
      status: {
        $cond: [{ $eq: ['$isOnline', true] }, 'online', 'offline'],
      },
    },
  },
{ $sort: { rank: 1 } }, // Optional: sort by rank
  { $limit: 5 },    ]);

    // TODO: Add today's calls count per astrologer (similar to revenue aggregation)

    res.json({
      stats: {
        totalUsers,
        onlineAstrologers,
        callsToday,
        revenueToday: `₹${revenueToday.toLocaleString('en-IN')}`,
        chatsToday,
        pendingApprovals,
        avgResponseTime: `${avgResponseMin} min`,
        activeSessions,
      },
      weeklyRevenue: revenueData,
      userGrowth: growthData,
      liveAstrologers,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};