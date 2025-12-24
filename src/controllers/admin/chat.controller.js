import mongoose from 'mongoose';
import { User } from '../../models/user.js';
import { ChatSession } from '../../models/chatapp/chatSession.js';

export const getAllAdminChat = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '', // REQUESTED, ACCEPTED, ACTIVE, COMPLETED, etc.
      dateRangeStart,
      dateRangeEnd,
      sortBy = 'requestedAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = {};

    // Search by user or astrologer name
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      const [users, astrologers] = await Promise.all([
        User.find({ role: 'user', fullName: searchRegex }).select('_id'),
        User.find({ role: 'astrologer', fullName: searchRegex }).select('_id'),
      ]);

      const userIds = users.map(u => u._id);
      const astroIds = astrologers.map(a => a._id);

      filter.$or = [
        { userId: { $in: userIds } },
        { astrologerId: { $in: astroIds } },
      ];
    }

    // Status filter
    if (status) {
      filter.status = status.toUpperCase();
    }

    // Date range filter
    if (dateRangeStart || dateRangeEnd) {
      filter.requestedAt = {};
      if (dateRangeStart) filter.requestedAt.$gte = new Date(dateRangeStart);
      if (dateRangeEnd) filter.requestedAt.$lte = new Date(dateRangeEnd);
    }

    // Aggregate with populated names
    const chatsAgg = await ChatSession.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      { $unwind: { path: '$astrologerDetails', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          sessionId: 1,
          user: '$userDetails.fullName',
          astrologer: '$astrologerDetails.fullName',
          duration: '$totalDuration',
          requestedAt: 1,
          totalCost: 1,
          status: 1,
        },
      },
      { $sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]);

    // Dashboard stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(todayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayEnd);
    yesterdayEnd.setDate(todayEnd.getDate() - 1);

    const [totalChatsToday, totalChatsYesterday, ongoingChats, avgDuration, revenueToday] = await Promise.all([
      ChatSession.countDocuments({ requestedAt: { $gte: todayStart, $lte: todayEnd } }),
      ChatSession.countDocuments({ requestedAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
      ChatSession.countDocuments({ status: { $in: ['ACTIVE', 'PAUSED'] } }),
      ChatSession.aggregate([
        { $match: { status: 'COMPLETED', totalDuration: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$totalDuration' } } },
      ]),
      ChatSession.aggregate([
        { $match: { status: 'COMPLETED', totalCost: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$totalCost' } } },
      ]),
    ]);

    const avgDurationMinutes = Math.floor((avgDuration[0]?.avg || 0) / 60);
    const formattedAvgDuration = `${avgDurationMinutes} min`;

    const revenue = revenueToday[0]?.total || 0;

    const chatsGrowthPercentage = totalChatsYesterday > 0
      ? ((totalChatsToday - totalChatsYesterday) / totalChatsYesterday * 100).toFixed(1)
      : '0.0';

    // Total count for pagination
    const total = await ChatSession.countDocuments(filter);

    res.json({
      stats: {
        totalChatsToday,
        ongoingChats,
        avgDuration: formattedAvgDuration,
        revenueToday: revenue,
        chatsGrowthPercentage,
      },
      chats: chatsAgg,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all chat sessions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};