import mongoose from 'mongoose';
import { Coupon, CouponUsage } from '../../models/Wallet/AstroWallet.js';

export const getAllAdminOffer = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '', // active, inactive
      type = '', // PERCENTAGE, FLAT_AMOUNT, etc.
      sortBy = 'priority',
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = {};

    // Search by code or name
    if (search) {
      filter.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    // Status filter (isActive)
    if (status) {
      filter.isActive = status === 'active';
    }

    // Discount type filter
    if (type) {
      filter.discountType = type.toUpperCase();
    }

    // Aggregate with usage count
    const couponsAgg = await Coupon.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'couponusages',
          localField: '_id',
          foreignField: 'couponId',
          as: 'usages',
        },
      },
      {
        $addFields: {
          totalUses: { $size: '$usages' },
          todayUses: {
            $size: {
              $filter: {
                input: '$usages',
                as: 'usage',
                cond: {
                  $gte: ['$$usage.usedAt', new Date(new Date().setHours(0, 0, 0, 0))],
                },
              },
            },
          },
          totalDiscountGiven: {
            $sum: {
              $map: {
                input: '$usages',
                as: 'usage',
                in: '$$usage.discountAmount',
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          code: 1,
          name: 1,
          type: '$discountType',
          value: '$value',
          minCartValue: 1,
          maxDiscount: 1,
          totalUses: 1,
          todayUses: 1,
          totalDiscountGiven: 1,
          isActive: 1,
          startAt: 1,
          endAt: 1,
          validTill: '$endAt', // for frontend
          status: { $cond: [{ $eq: ['$isActive', true] }, 'active', 'inactive'] },
          priority: 1,
        },
      },
      { $sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]);

    // Dashboard stats
    const [activeOffers, scheduledOffers, totalUsesToday, totalDiscountToday] = await Promise.all([
      Coupon.countDocuments({ isActive: true }),
      Coupon.countDocuments({ startAt: { $gt: new Date() } }),
      CouponUsage.countDocuments({
        usedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
      CouponUsage.aggregate([
        {
          $match: {
            usedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        },
        { $group: { _id: null, total: { $sum: '$discountAmount' } } },
      ]),
    ]);

    const total = await Coupon.countDocuments(filter);

    res.json({
      stats: {
        activeOffers,
        totalUsesToday,
        totalDiscountToday: totalDiscountToday[0]?.total || 0,
        scheduledOffers,
      },
      coupons: couponsAgg,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all coupons error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


export const createCoupon = async (req, res) => {
  try {
    const {
      code,
      name,
      description,
      discountType,
      value,
      currency = 'INR',
      categories,
      sessionTypes,
      astrologerTiers,
      minCartValue = 0,
      maxDiscount,
      usageLimit,
      perUserLimit = 1,
      userSegments,
      firstTimeOnly = false,
      specificUsers,
      startAt = new Date(),
      endAt,
      isActive = true,
      combinable = false,
      autoApply = false,
      priority = 1,
    } = req.body;

    // Validation
    if (!code || !name || !discountType || !value) {
      return res.status(400).json({ message: 'Code, name, discountType, and value are required' });
    }

    if (!['PERCENTAGE', 'FLAT_AMOUNT', 'BONUS_PERCENTAGE', 'CASHBACK', 'FREE_MINUTES', 'FIXED_PRICE'].includes(discountType)) {
      return res.status(400).json({ message: 'Invalid discountType' });
    }

    if (value <= 0) {
      return res.status(400).json({ message: 'Value must be positive' });
    }

    // Check for duplicate code
    const existingCoupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({ message: 'Coupon code already exists' });
    }

    // Create new coupon
    const coupon = await Coupon.create({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description,
      discountType,
      value: Number(value),
      currency,
      categories: categories || [],
      sessionTypes: sessionTypes || [],
      astrologerTiers: astrologerTiers || [],
      minCartValue: Number(minCartValue),
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      usageLimit: usageLimit || null,
      perUserLimit: Number(perUserLimit),
      userSegments: userSegments || [],
      firstTimeOnly,
      specificUsers: specificUsers || [],
      startAt: startAt ? new Date(startAt) : new Date(),
      endAt: endAt ? new Date(endAt) : null,
      isActive,
      combinable,
      autoApply,
      priority: Number(priority),
    });

    res.status(201).json({
      message: 'Coupon created successfully',
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discountType,
        value: coupon.value,
        minCartValue: coupon.minCartValue,
        maxDiscount: coupon.maxDiscount,
        isActive: coupon.isActive,
        validTill: coupon.endAt,
        status: coupon.isActive ? 'active' : 'inactive',
      },
    });
  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};