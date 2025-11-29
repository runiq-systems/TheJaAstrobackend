// controllers/rechargeController.js
import { RechargeHistory, Wallet, Transaction, Coupon, CouponUsage, generateTxId, toBaseUnits } from '../../models/Wallet/AstroWallet.js';

export const initiateRecharge = async (req, res) => {
    try {
        const userId  = req.user.id;
        const { amount, currency = 'INR', paymentGateway, couponCode } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }

        let coupon = null;
        let couponDiscount = 0;
        let finalAmount = amount;
        let bonusAmount = 0;

        // Apply coupon if provided
        if (couponCode) {
            coupon = await Coupon.findOne({ 
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

            // Check usage limit
            const usageCount = await CouponUsage.countDocuments({ 
                couponId: coupon._id,
                userId 
            });

            if (coupon.perUserLimit && usageCount >= coupon.perUserLimit) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon usage limit exceeded'
                });
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
            if (coupon.discountType === 'PERCENTAGE') {
                couponDiscount = (amount * coupon.value) / 100;
                if (coupon.maxDiscount && couponDiscount > coupon.maxDiscount) {
                    couponDiscount = coupon.maxDiscount;
                }
            } else if (coupon.discountType === 'FLAT_AMOUNT') {
                couponDiscount = coupon.value;
            } else if (coupon.discountType === 'BONUS_PERCENTAGE') {
                bonusAmount = (amount * coupon.value) / 100;
            }

            finalAmount = amount - couponDiscount;
        }

        // Create recharge record
        const recharge = new RechargeHistory({
            userId,
            requestedAmount: amount,
            currency,
            bonusAmount,
            couponDiscount,
            finalAmount,
            paymentGateway,
            status: 'INITIATED',
            couponId: coupon?._id,
            meta: { 
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            }
        });

        await recharge.save();

        // Create coupon usage record if coupon applied
        if (coupon) {
            const couponUsage = new CouponUsage({
                couponId: coupon._id,
                userId,
                rechargeId: recharge._id,
                discountAmount: couponDiscount,
                cartValue: amount,
                status: 'APPLIED',
                meta: { rechargeId: recharge._id }
            });
            await couponUsage.save();
        }

        res.json({
            success: true,
            message: 'Recharge initiated successfully',
            data: {
                rechargeId: recharge._id,
                amount: finalAmount,
                bonusAmount,
                couponDiscount,
                paymentGateway,
                nextStep: 'Redirect to payment gateway'
            }
        });
    } catch (error) {
        console.error('Initiate recharge error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const processRechargeCallback = async (req, res) => {
    try {
        const { rechargeId, status, gatewayTxnId, gatewayResponse } = req.body;

        const recharge = await RechargeHistory.findById(rechargeId);
        if (!recharge) {
            return res.status(404).json({
                success: false,
                message: 'Recharge not found'
            });
        }

        if (recharge.status !== 'INITIATED') {
            return res.status(400).json({
                success: false,
                message: 'Recharge already processed'
            });
        }

        recharge.status = status;
        recharge.gatewayTxnId = gatewayTxnId;
        recharge.gatewayResponse = gatewayResponse;

        if (status === 'SUCCESS') {
            recharge.processedAt = new Date();
            recharge.completedAt = new Date();

            // Update wallet balance
            const wallet = await Wallet.findOne({ userId: recharge.userId });
            if (!wallet) {
                // Create wallet if doesn't exist
                const newWallet = new Wallet({
                    userId: recharge.userId,
                    balances: [{
                        currency: recharge.currency,
                        available: recharge.finalAmount,
                        bonus: recharge.bonusAmount,
                        locked: 0,
                        pendingIncoming: 0
                    }]
                });
                await newWallet.save();
            } else {
                const balanceIndex = wallet.balances.findIndex(b => b.currency === recharge.currency);
                if (balanceIndex >= 0) {
                    wallet.balances[balanceIndex].available += recharge.finalAmount;
                    wallet.balances[balanceIndex].bonus += recharge.bonusAmount;
                } else {
                    wallet.balances.push({
                        currency: recharge.currency,
                        available: recharge.finalAmount,
                        bonus: recharge.bonusAmount,
                        locked: 0,
                        pendingIncoming: 0
                    });
                }
                wallet.lastBalanceUpdate = new Date();
                await wallet.save();
            }

            // Create transaction record
            const txId = generateTxId('RCH');
            const transaction = new Transaction({
                txId,
                userId: recharge.userId,
                entityType: 'USER',
                entityId: recharge.userId,
                type: 'CREDIT',
                category: 'RECHARGE',
                amount: recharge.finalAmount,
                currency: recharge.currency,
                bonusAmount: recharge.bonusAmount,
                status: 'SUCCESS',
                description: `Wallet recharge via ${recharge.paymentGateway}`,
                gatewayRef: gatewayTxnId,
                processedAt: new Date(),
                completedAt: new Date(),
                meta: { rechargeId: recharge._id }
            });

            await transaction.save();

            // Update coupon usage status
            if (recharge.couponId) {
                await CouponUsage.findOneAndUpdate(
                    { rechargeId: recharge._id },
                    { status: 'USED', usedAt: new Date() }
                );
            }
        }

        await recharge.save();

        res.json({
            success: true,
            message: `Recharge ${status.toLowerCase()}`,
            data: { rechargeId: recharge._id, status }
        });
    } catch (error) {
        console.error('Recharge callback error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getRechargeHistory = async (req, res) => {
    try {
        const { userId } = req.user;
        const { page = 1, limit = 20, status } = req.query;

        const filter = { userId };
        if (status) filter.status = status;

        const recharges = await RechargeHistory.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('couponId', 'code name discountType value')
            .lean();

        const total = await RechargeHistory.countDocuments(filter);

        res.json({
            success: true,
            data: {
                recharges,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get recharge history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};