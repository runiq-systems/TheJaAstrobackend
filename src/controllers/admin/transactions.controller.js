import mongoose from 'mongoose';
import { Transaction } from '../../models/Wallet/AstroWallet.js';
import { User } from '../../models/user.js';

export const getAllAdminTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      type = '',
      status = '',
      category = '',
      dateRangeStart,
      dateRangeEnd,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = {};

    // Search by txId, user name, or astrologer name
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      const [users, astrologers] = await Promise.all([
        User.find({ role: 'user', fullName: searchRegex }).select('_id'),
        User.find({ role: 'astrologer', fullName: searchRegex }).select('_id'),
      ]);

      const userIds = users.map(u => u._id);
      const astroIds = astrologers.map(a => a._id);

      filter.$or = [
        { txId: searchRegex },
        { userId: { $in: userIds } },
        { entityId: { $in: astroIds } },
      ];
    }

    // Type filter
    if (type) filter.type = type.toUpperCase();

    // Status filter
    if (status) filter.status = status.toUpperCase();

    // Category filter
    if (category) filter.category = category.toUpperCase();

    // Date range filter
    if (dateRangeStart || dateRangeEnd) {
      filter.createdAt = {};
      if (dateRangeStart) filter.createdAt.$gte = new Date(dateRangeStart);
      if (dateRangeEnd) filter.createdAt.$lte = new Date(dateRangeEnd);
    }

    // Aggregate with populated user/astrologer names
    const transactionsAgg = await Transaction.aggregate([
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
          localField: 'entityId',
          foreignField: '_id',
          as: 'entityDetails',
        },
      },
      { $unwind: { path: '$entityDetails', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          userName: '$userDetails.fullName',
          entityName: '$entityDetails.fullName',
        },
      },
      {
        $project: {
          _id: 1,
          txId: 1,
          type: 1,
          user: '$userName',
          astrologer: { $cond: [{ $eq: ['$entityType', 'ASTROLOGER'] }, '$entityName', '-'] },
          amount: 1,
          commissionAmount: 1,
          createdAt: 1,
          status: 1,
          category: 1,
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

    const [totalTransactionsToday, totalTransactionsYesterday, transactionVolume, totalCommission, successCount, totalCount] = await Promise.all([
      Transaction.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
      Transaction.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
      ]),
      Transaction.countDocuments({ status: 'SUCCESS' }),
      Transaction.countDocuments({}),
    ]);

    const volume = transactionVolume[0]?.total || 0;
    const commission = totalCommission[0]?.total || 0;
    const successRate = totalCount > 0 ? (successCount / totalCount * 100).toFixed(1) : '0.0';

    const growthPercentage = totalTransactionsYesterday > 0
      ? ((totalTransactionsToday - totalTransactionsYesterday) / totalTransactionsYesterday * 100).toFixed(1)
      : '0.0';

    // Total count for pagination
    const total = await Transaction.countDocuments(filter);

    res.json({
      stats: {
        totalTransactions: total,
        transactionVolume: volume,
        totalCommission: commission,
        successRate,
        transactionsToday: totalTransactionsToday,
        transactionsGrowthPercentage: growthPercentage,
      },
      transactions: transactionsAgg,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};