// controllers/couponController.js
import { Coupon, CouponUsage } from '../../models/Wallet/AstroWallet.js';

export const createCoupon = async (req, res) => {
    try {
        const {
            code, name, description, discountType, value, currency = 'INR',
            categories, sessionTypes, astrologerTiers, minCartValue, maxDiscount,
            usageLimit, perUserLimit, userSegments, firstTimeOnly, specificUsers,
            startAt, endAt, combinable, autoApply, priority
        } = req.body;

        const createdBy = req.user.id;

        // Check if coupon code already exists
        const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
        if (existingCoupon) {
            return res.status(400).json({
                success: false,
                message: 'Coupon code already exists'
            });
        }

        const coupon = new Coupon({
            code: code.toUpperCase(),
            name,
            description,
            discountType,
            value,
            currency,
            categories: categories || [],
            sessionTypes: sessionTypes || [],
            astrologerTiers: astrologerTiers || [],
            minCartValue: minCartValue || 0,
            maxDiscount,
            usageLimit,
            perUserLimit: perUserLimit || 1,
            userSegments: userSegments || [],
            firstTimeOnly: firstTimeOnly || false,
            specificUsers: specificUsers || [],
            startAt: startAt || new Date(),
            endAt,
            combinable: combinable || false,
            autoApply: autoApply || false,
            priority: priority || 1,
            createdBy,
            isActive: true
        });

        await coupon.save();

        res.status(201).json({
            success: true,
            message: 'Coupon created successfully',
            data: coupon
        });
    } catch (error) {
        console.error('Create coupon error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const validateCoupon = async (req, res) => {
    try {
        const userId = req.user.id;
        const { couponCode, cartValue, sessionType, astrologerTier } = req.body;

        const coupon = await Coupon.findOne({
            code: couponCode.toUpperCase(),
            isActive: true,
            startAt: { $lte: new Date() },
            $or: [
                { endAt: null },
                { endAt: { $gte: new Date() } }
            ]
        });

        if (!coupon) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired coupon'
            });
        }

        // Check minimum cart value
        if (cartValue < coupon.minCartValue) {
            return res.status(400).json({
                success: false,
                message: `Minimum cart value of ${coupon.minCartValue} required`
            });
        }

        // Check session type restrictions
        if (sessionType && coupon.sessionTypes.length > 0 && !coupon.sessionTypes.includes(sessionType)) {
            return res.status(400).json({
                success: false,
                message: 'Coupon not valid for this session type'
            });
        }

        // Check astrologer tier restrictions
        if (astrologerTier && coupon.astrologerTiers.length > 0 && !coupon.astrologerTiers.includes(astrologerTier)) {
            return res.status(400).json({
                success: false,
                message: 'Coupon not valid for this astrologer tier'
            });
        }

        // Check first time user restriction
        if (coupon.firstTimeOnly) {
            const previousRecharges = await RechargeHistory.countDocuments({ userId });
            if (previousRecharges > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon only for first-time users'
                });
            }
        }

        // Check user-specific restrictions
        if (coupon.specificUsers.length > 0 && !coupon.specificUsers.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'Coupon not valid for this user'
            });
        }

        // Check usage limits
        if (coupon.perUserLimit) {
            const userUsageCount = await CouponUsage.countDocuments({
                couponId: coupon._id,
                userId
            });
            if (userUsageCount >= coupon.perUserLimit) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon usage limit exceeded'
                });
            }
        }

        if (coupon.usageLimit) {
            const totalUsage = await CouponUsage.countDocuments({ couponId: coupon._id });
            if (totalUsage >= coupon.usageLimit) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon has reached maximum usage'
                });
            }
        }

        // Calculate discount
        let discountAmount = 0;
        let bonusAmount = 0;

        if (coupon.discountType === 'PERCENTAGE') {
            discountAmount = (cartValue * coupon.value) / 100;
            if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
                discountAmount = coupon.maxDiscount;
            }
        } else if (coupon.discountType === 'FLAT_AMOUNT') {
            discountAmount = coupon.value;
        } else if (coupon.discountType === 'BONUS_PERCENTAGE') {
            bonusAmount = (cartValue * coupon.value) / 100;
        } else if (coupon.discountType === 'FREE_MINUTES') {
            discountAmount = 0; // Handle free minutes separately
        }

        res.json({
            success: true,
            message: 'Coupon is valid',
            data: {
                coupon: {
                    id: coupon._id,
                    code: coupon.code,
                    name: coupon.name,
                    discountType: coupon.discountType,
                    value: coupon.value,
                    discountAmount,
                    bonusAmount,
                    finalAmount: cartValue - discountAmount
                }
            }
        });
    } catch (error) {
        console.error('Validate coupon error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getCoupons = async (req, res) => {
    try {
        const { page = 1, limit = 20, isActive, discountType } = req.query;

        const filter = {};
        if (isActive !== undefined) filter.isActive = isActive === 'true';
        if (discountType) filter.discountType = discountType;

        const coupons = await Coupon.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('createdBy', 'name email')
            .lean();

        const total = await Coupon.countDocuments(filter);

        res.json({
            success: true,
            data: {
                coupons,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get coupons error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const updateCouponStatus = async (req, res) => {
    try {
        const { couponId } = req.params;
        const { isActive } = req.body;

        const coupon = await Coupon.findByIdAndUpdate(
            couponId,
            { isActive },
            { new: true }
        );

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        res.json({
            success: true,
            message: `Coupon ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: coupon
        });
    } catch (error) {
        console.error('Update coupon status error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};