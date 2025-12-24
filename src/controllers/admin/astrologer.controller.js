import mongoose from 'mongoose';
import { User } from '../../models/user.js';
import { Astrologer } from '../../models/astrologer.js';
 
export const getAllAdminAstrologers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '', // online, offline, busy, pending, approved, etc.
      verified = '', // true/false
      sortBy = 'rating', // rating, yearOfExperience, etc.
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filters
    const userFilter = { role: 'astrologer' };
    if (search) {
      userFilter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
      ];
    }

    const astroFilter = {};
    if (status) {
      if (['online', 'offline', 'busy'].includes(status)) {
        astroFilter.status = status;
      } else if (['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
        astroFilter.accountStatus = status;
      }
    }
    if (verified !== '') {
      astroFilter.astrologerApproved = verified === 'true';
    }

    // Aggregate: Join User + Astrologer + Stats
    const astrologersAgg = await User.aggregate([
      { $match: userFilter },
      {
        $lookup: {
          from: 'astrologers',
          localField: '_id',
          foreignField: 'userId',
          as: 'astroDetails',
        },
      },
      { $unwind: { path: '$astroDetails', preserveNullAndEmptyArrays: true } },
      { $match: astroFilter },
      // Performance stats
      {
        $lookup: {
          from: 'calls',
          localField: '_id',
          foreignField: 'astrologerId',
          pipeline: [
            { $match: { status: { $in: ['COMPLETED', 'CONNECTED'] } } },
            { $count: 'totalCalls' },
          ],
          as: 'callStats',
        },
      },
      {
        $lookup: {
          from: 'chats',
          localField: '_id',
          foreignField: 'astrologerId',
          pipeline: [
            { $match: { status: { $in: ['COMPLETED', 'CONNECTED'] } } },
            { $count: 'totalChats' },
          ],
          as: 'chatStats',
        },
      },
      {
        $lookup: {
          from: 'reviews',
          localField: '_id',
          foreignField: 'astrologerId',
          pipeline: [
            { $group: { _id: null, avgRating: { $avg: '$stars' }, count: { $sum: 1 } } },
          ],
          as: 'reviewStats',
        },
      },
      {
        $addFields: {
          totalCalls: { $ifNull: [{ $arrayElemAt: ['$callStats.totalCalls', 0] }, 0] },
          totalChats: { $ifNull: [{ $arrayElemAt: ['$chatStats.totalChats', 0] }, 0] },
          reviewCount: { $ifNull: [{ $arrayElemAt: ['$reviewStats.count', 0] }, 0] },
          avgRating: { $round: [{ $ifNull: [{ $arrayElemAt: ['$reviewStats.avgRating', 0] }, 0] }, 1] },
          earnings: 0, // TODO: Aggregate from payouts/earnings if you have
        },
      },
      {
        $project: {
          _id: 1,
          name: '$fullName',
          photo: '$astroDetails.photo',
          skill: { $arrayElemAt: ['$astroDetails.specialization', 0] },
          experience: '$astroDetails.yearOfExperience',
          pricing: '$astroDetails.ratepermin',
          rating: '$avgRating',
          verified: '$astroDetails.astrologerApproved',
          status: '$astroDetails.status',
          accountStatus: '$astroDetails.accountStatus',
          totalCalls: 1,
          totalChats: 1,
          earnings: 1,
          reviewCount: 1,
          isOnline: 1,
          joinedOn: '$createdAt',
        },
      },
      { $sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]);

    // Dashboard stats
    const totalAstrologers = await Astrologer.countDocuments();
    const onlineAstrologers = await User.countDocuments({ role: 'astrologer', isOnline: true });
    const pendingVerification = await Astrologer.countDocuments({ astrologerApproved: false });
    const avgRatingAgg = await Astrologer.aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]);
    const avgRating = avgRatingAgg[0]?.avg?.toFixed(1) || '0.0';

    const totalCount = astrologersAgg.length < parseInt(limit)
      ? astrologersAgg.length + skip
      : await User.aggregate([
          { $match: userFilter },
          { $lookup: { from: 'astrologers', localField: '_id', foreignField: 'userId', as: 'astro' } },
          { $unwind: '$astro' },
          { $match: astroFilter },
          { $count: 'total' },
        ]).then(r => r[0]?.total || 0);

    res.json({
      stats: {
        totalAstrologers,
        onlineNow: onlineAstrologers,
        pendingVerification,
        avgRating,
      },
      astrologers: astrologersAgg,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all astrologers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// Optional: Get single astrologer details (for modal)
export const getAstrologerDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const astrologer = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id), role: 'astrologer' } },
      {
        $lookup: {
          from: 'astrologers',
          localField: '_id',
          foreignField: 'userId',
          as: 'astroDetails',
        },
      },
      { $unwind: '$astroDetails' },
      {
        $lookup: {
          from: 'reviews',
          localField: '_id',
          foreignField: 'astrologerId',
          pipeline: [
            { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
          ],
          as: 'reviewStats',
        },
      },
      {
        $addFields: {
          avgRating: { $ifNull: [{ $arrayElemAt: ['$reviewStats.avg', 0] }, 0] },
          reviewCount: { $ifNull: [{ $arrayElemAt: ['$reviewStats.count', 0] }, 0] },
        },
      },
      {
        $project: {
          _id: 1,
          name: '$fullName',
          photo: '$astroDetails.photo',
          skill: { $arrayElemAt: ['$astroDetails.specialization', 0] },
          experience: '$astroDetails.yearOfExperience',
          pricing: '$astroDetails.ratepermin',
          rating: '$avgRating',
          verified: '$astroDetails.astrologerApproved',
          status: '$astroDetails.status',
          accountStatus: '$astroDetails.accountStatus',
          totalCalls: 0, // TODO: Add real aggregation
          totalChats: 0,
          earnings: 0,
          reviewCount: 1,
          isOnline: 1,
          bio: '$astroDetails.bio',
          languages: '$astroDetails.languages',
        },
      },
    ]);

    if (!astrologer.length) {
      return res.status(404).json({ message: 'Astrologer not found' });
    }

    res.json({ astrologer: astrologer[0] });
  } catch (error) {
    console.error('Get astrologer details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};