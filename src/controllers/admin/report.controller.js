import mongoose from 'mongoose';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Transaction } from '../../models/Wallet/AstroWallet.js';
import { Call } from '../../models/calllogs/call.js';
import { User } from '../../models/user.js';
import { Chat } from '../../models/chatapp/chat.js';
import { CallSession } from '../../models/calllogs/callSession.js';
import { ChatSession } from '../../models/chatapp/chatSession.js';
import { Astrologer } from '../../models/astrologer.js';

export const getAdminPlatformReports = async (req, res) => {
  try {
    // === 1. Total Revenue (all time) ===
    const totalRevenue = await Transaction.aggregate([
      { $match: { type: 'DEBIT', status: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const revenueAllTime = totalRevenue[0]?.total || 0;

    // === 2. Total Consultations (Completed CallSessions + ChatSessions) ===
    const [totalCalls, totalChats] = await Promise.all([
      CallSession.countDocuments({ status: 'COMPLETED' }),
      ChatSession.countDocuments({ status: 'COMPLETED' }),
    ]);
    const totalConsultations = totalCalls + totalChats;

    // === 3. Active Users (last seen in last 30 days) ===
    const activeUsers = await User.countDocuments({
      lastSeen: { $gte: subMonths(new Date(), 1) },
    });

    // === 4. Avg Session Time (Completed CallSessions + ChatSessions) ===
    const [avgCallDuration, avgChatDuration] = await Promise.all([
      CallSession.aggregate([
        { $match: { status: 'COMPLETED', totalDuration: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$totalDuration' } } },
      ]),
      ChatSession.aggregate([
        { $match: { status: 'COMPLETED', totalDuration: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$totalDuration' } } },
      ]),
    ]);

    const avgCallSec = avgCallDuration[0]?.avg || 0;
    const avgChatSec = avgChatDuration[0]?.avg || 0;
    const avgSessionSec = (avgCallSec + avgChatSec) / 2;
    const avgMin = Math.floor(avgSessionSec / 60);
    const avgSec = Math.floor(avgSessionSec % 60);
    const avgSessionTime = `${avgMin}:${avgSec.toString().padStart(2, '0')} min`;

    // === 5. Calls vs Chats (Last 6 Months) ===
    const months = Array.from({ length: 6 }, (_, i) => {
      const date = subMonths(new Date(), i);
      return {
        start: startOfMonth(date),
        end: endOfMonth(date),
        month: date.toLocaleString('default', { month: 'short' }),
      };
    }).reverse();

    const callsVsChats = await Promise.all(
      months.map(async (m) => {
        const [calls, chats] = await Promise.all([
          CallSession.countDocuments({
            startedAt: { $gte: m.start, $lte: m.end },
            status: 'COMPLETED',
          }),
          ChatSession.countDocuments({
            startedAt: { $gte: m.start, $lte: m.end },
            status: 'COMPLETED',
          }),
        ]);
        return { month: m.month, calls, chats };
      })
    );

    // === 6. Revenue Trend (Last 6 Months) ===
    const revenueTrend = await Promise.all(
      months.map(async (m) => {
        const revenue = await Transaction.aggregate([
          {
            $match: {
              createdAt: { $gte: m.start, $lte: m.end },
              type: 'DEBIT',
              status: 'SUCCESS',
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        return { month: m.month, revenue: revenue[0]?.total || 0 };
      })
    );

    // === 7. Service Distribution ===
    const totalServices = totalCalls + totalChats;
    const serviceDistribution = [
      { name: 'Calls', value: Math.round((totalCalls / totalServices) * 100) || 0, color: '#0D1B52' },
      { name: 'Chats', value: Math.round((totalChats / totalServices) * 100) || 0, color: '#E3C46F' },
      { name: 'Others', value: 0, color: '#1a2f7a' },
    ];

    // === 8. Top Performing Astrologers (Last 30 days) ===
const topAstrologers = await Astrologer.aggregate([
      {
        $match: {
          astrologerApproved: true,
          accountStatus: "approved",
          rank: { $ne: null }, // Only astrologers with assigned rank
        },
      },
      {
        $sort: { rank: 1 }, // Lowest rank number = best
      },
      {
        $limit: 4, // Top 4
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          name: '$user.fullName',
          photo: '$photo',
          rank: 1,
          ratepermin: 1,
          languages: 1,
        },
      },
    ]);

    res.json({
      totalRevenue: revenueAllTime,
      totalConsultations,
      activeUsers,
      avgSessionTime,
      callsVsChats,
      revenueTrend,
      serviceDistribution,
      topAstrologers,
    });
  } catch (error) {
    console.error('Get platform reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};