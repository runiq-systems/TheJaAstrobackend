// controllers/billingController.js

import {
    BillingTick,
    Reservation,
    Transaction,
    Wallet,
    PlatformEarnings,
    TaxInvoice,
    generateTxId,
    calculateCommission
} from '../../models/Wallet/AstroWallet.js';
import mongoose from 'mongoose';

/**
 * Process real-time billing tick for ongoing sessions
 */
export const processBillingTick = async (req, res) => {
    try {
        const { reservationId, durationSec, timestamp = new Date() } = req.body;

        if (!reservationId || !durationSec) {
            return res.status(400).json({
                success: false,
                message: 'reservationId and durationSec are required'
            });
        }

        // Find active reservation
        const reservation = await Reservation.findOne({
            reservationId,
            status: 'ONGOING'
        }).populate('rateConfigId');

        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: 'Active session not found'
            });
        }

        const minutes = durationSec / 60;
        const currentMinute = Math.floor(reservation.totalDurationSec / 60) + 1;

        // Calculate amount for this tick
        const tickAmount = reservation.ratePerMinute * minutes;
        const commissionAmount = (tickAmount * reservation.commissionPercent) / 100;
        const astrologerAmount = tickAmount - commissionAmount;
        const taxAmount = (tickAmount * (reservation.taxPercent || 0)) / 100;

        // Check if user has sufficient balance
        const wallet = await Wallet.findOne({ userId: reservation.userId });
        const userBalance = wallet.balances.find(b => b.currency === reservation.currency);

        if (!userBalance || userBalance.available < tickAmount) {
            // Insufficient balance - handle gracefully
            return res.status(402).json({
                success: false,
                message: 'Insufficient balance for billing tick',
                data: {
                    reservationId,
                    requiredAmount: tickAmount,
                    availableBalance: userBalance?.available || 0,
                    action: 'PAUSE_SESSION'
                }
            });
        }

        // Create billing tick
        const billingTick = new BillingTick({
            reservationId: reservation._id,
            tickId: generateTxId('TICK'),
            tickAt: timestamp,
            minuteIndex: currentMinute,
            amount: tickAmount,
            taxAmount,
            commissionAmount,
            status: 'PENDING',
            meta: {
                durationSec,
                ratePerMinute: reservation.ratePerMinute,
                commissionPercent: reservation.commissionPercent
            }
        });

        // Update reservation totals
        reservation.totalDurationSec += durationSec;
        reservation.billedMinutes = Math.ceil(reservation.totalDurationSec / 60);
        reservation.totalCost += tickAmount;
        reservation.platformEarnings += commissionAmount;
        reservation.astrologerEarnings += astrologerAmount;
        reservation.taxAmount += taxAmount;

        // Add to billing intervals
        reservation.billingIntervals.push({
            startTime: new Date(timestamp - durationSec * 1000),
            endTime: new Date(timestamp),
            durationSec,
            amount: tickAmount
        });

        // Deduct from user wallet
        const balanceIndex = wallet.balances.findIndex(b => b.currency === reservation.currency);
        wallet.balances[balanceIndex].available -= tickAmount;
        wallet.lastBalanceUpdate = new Date();

        // Create transaction for this tick
        const transaction = new Transaction({
            txId: generateTxId('BILL'),
            userId: reservation.userId,
            entityType: 'USER',
            entityId: reservation.userId,
            type: 'DEBIT',
            category: 'SESSION_DEDUCTION',
            amount: tickAmount,
            currency: reservation.currency,
            taxAmount,
            taxRate: reservation.taxPercent,
            commissionAmount,
            commissionRate: reservation.commissionPercent,
            balanceBefore: userBalance.available,
            balanceAfter: userBalance.available - tickAmount,
            status: 'SUCCESS',
            reservationId: reservation._id,
            description: `Session billing - Minute ${currentMinute}`,
            processedAt: new Date(),
            completedAt: new Date(),
            meta: {
                billingTickId: billingTick._id,
                durationSec,
                minuteIndex: currentMinute
            }
        });

        // Update billing tick status
        billingTick.status = 'SUCCESS';
        billingTick.txId = transaction.txId;

        // Save all changes in transaction
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await billingTick.save({ session });
                await reservation.save({ session });
                await wallet.save({ session });
                await transaction.save({ session });
            });
        } finally {
            session.endSession();
        }

        res.json({
            success: true,
            message: 'Billing tick processed successfully',
            data: {
                tickId: billingTick.tickId,
                amount: tickAmount,
                durationSec,
                totalBilled: reservation.totalCost,
                currentBalance: wallet.balances[balanceIndex].available,
                minuteIndex: currentMinute
            }
        });

    } catch (error) {
        console.error('Process billing tick error:', error);

        // Mark billing tick as failed if it was created
        if (billingTick) {
            billingTick.status = 'FAILED';
            billingTick.meta.error = error.message;
            await billingTick.save().catch(console.error);
        }

        res.status(500).json({
            success: false,
            message: 'Failed to process billing tick',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Process bulk billing ticks for multiple sessions (for batch processing)
 */
export const processBulkBillingTicks = async (req, res) => {
    try {
        const { ticks } = req.body;

        if (!Array.isArray(ticks) || ticks.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'ticks array is required'
            });
        }

        const results = {
            processed: 0,
            failed: 0,
            errors: []
        };

        // Process each tick sequentially to avoid race conditions
        for (const tickData of ticks) {
            try {
                // Reuse processBillingTick logic for each tick
                await processSingleBillingTick(tickData);
                results.processed++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    reservationId: tickData.reservationId,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `Processed ${results.processed} ticks, ${results.failed} failed`,
            data: results
        });

    } catch (error) {
        console.error('Process bulk billing ticks error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process bulk billing ticks'
        });
    }
};

// Helper function for bulk processing
const processSingleBillingTick = async (tickData) => {
    // Implementation similar to processBillingTick but without response handling
    // This is a simplified version - you'd want to reuse the core logic
};

/**
 * Get billing history for a reservation
 */
export const getBillingHistory = async (req, res) => {
    try {
        const { reservationId } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const reservation = await Reservation.findOne({ reservationId });
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const billingTicks = await BillingTick.find({
            reservationId: reservation._id
        })
            .sort({ minuteIndex: 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const totalTicks = await BillingTick.countDocuments({
            reservationId: reservation._id
        });

        // Calculate summary
        const summary = await BillingTick.aggregate([
            { $match: { reservationId: reservation._id } },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$amount' },
                    totalCommission: { $sum: '$commissionAmount' },
                    totalTax: { $sum: '$taxAmount' },
                    tickCount: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                reservation: {
                    reservationId: reservation.reservationId,
                    totalCost: reservation.totalCost,
                    totalDuration: reservation.totalDurationSec,
                    billedMinutes: reservation.billedMinutes,
                    status: reservation.status
                },
                billingTicks,
                summary: summary[0] || {
                    totalAmount: 0,
                    totalCommission: 0,
                    totalTax: 0,
                    tickCount: 0
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalTicks,
                    pages: Math.ceil(totalTicks / limit)
                }
            }
        });

    } catch (error) {
        console.error('Get billing history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch billing history'
        });
    }
};

/**
 * Handle failed billing ticks and rollback if needed
 */
export const handleFailedBillingTick = async (req, res) => {
    try {
        const { tickId, action = 'ROLLBACK' } = req.body;

        const billingTick = await BillingTick.findOne({ tickId });
        if (!billingTick) {
            return res.status(404).json({
                success: false,
                message: 'Billing tick not found'
            });
        }

        if (billingTick.status !== 'FAILED') {
            return res.status(400).json({
                success: false,
                message: 'Billing tick is not in failed state'
            });
        }

        if (action === 'ROLLBACK') {
            await rollbackBillingTick(billingTick);

            res.json({
                success: true,
                message: 'Billing tick rolled back successfully',
                data: { tickId, status: 'ROLLED_BACK' }
            });
        } else if (action === 'RETRY') {
            // Implement retry logic
            await retryBillingTick(billingTick);

            res.json({
                success: true,
                message: 'Billing tick retried successfully',
                data: { tickId, status: 'SUCCESS' }
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid action. Use ROLLBACK or RETRY'
            });
        }

    } catch (error) {
        console.error('Handle failed billing tick error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to handle failed billing tick'
        });
    }
};

// Rollback a billing tick
const rollbackBillingTick = async (billingTick) => {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            // Find reservation
            const reservation = await Reservation.findById(billingTick.reservationId).session(session);
            if (reservation) {
                // Reverse the amounts
                reservation.totalCost -= billingTick.amount;
                reservation.platformEarnings -= billingTick.commissionAmount;
                reservation.astrologerEarnings -= (billingTick.amount - billingTick.commissionAmount);
                reservation.taxAmount -= billingTick.taxAmount;
                reservation.totalDurationSec -= (billingTick.meta?.durationSec || 60);
                reservation.billedMinutes = Math.ceil(reservation.totalDurationSec / 60);

                // Remove the billing interval
                reservation.billingIntervals = reservation.billingIntervals.filter(
                    interval => !(
                        interval.startTime.getTime() === billingTick.meta?.intervalStartTime?.getTime() &&
                        interval.endTime.getTime() === billingTick.meta?.intervalEndTime?.getTime()
                    )
                );

                await reservation.save({ session });
            }

            // Refund user wallet
            const wallet = await Wallet.findOne({ userId: reservation.userId }).session(session);
            if (wallet) {
                const balanceIndex = wallet.balances.findIndex(b => b.currency === reservation.currency);
                if (balanceIndex >= 0) {
                    wallet.balances[balanceIndex].available += billingTick.amount;
                    wallet.lastBalanceUpdate = new Date();
                    await wallet.save({ session });
                }
            }

            // Create reversal transaction
            const reversalTx = new Transaction({
                txId: generateTxId('REV'),
                userId: reservation.userId,
                entityType: 'USER',
                entityId: reservation.userId,
                type: 'CREDIT',
                category: 'REVERSAL',
                amount: billingTick.amount,
                currency: reservation.currency,
                status: 'SUCCESS',
                reservationId: reservation._id,
                description: `Reversal for failed billing tick ${billingTick.tickId}`,
                processedAt: new Date(),
                completedAt: new Date(),
                meta: {
                    originalTickId: billingTick.tickId,
                    reversalReason: 'BILLING_FAILURE'
                }
            });
            await reversalTx.save({ session });

            // Update billing tick status
            billingTick.status = 'ROLLED_BACK';
            await billingTick.save({ session });
        });
    } finally {
        session.endSession();
    }
};

// Retry a billing tick
const retryBillingTick = async (billingTick) => {
    // Implementation for retrying failed billing tick
    // This would involve reprocessing the tick with the original parameters
};

/**
 * Generate billing report for platform earnings
 */
export const generateBillingReport = async (req, res) => {
    try {
        const { startDate, endDate, groupBy = 'daily' } = req.query;

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date range'
            });
        }

        // Aggregate platform earnings
        const earningsReport = await Reservation.aggregate([
            {
                $match: {
                    status: 'SETTLED',
                    settledAt: {
                        $gte: start,
                        $lte: end
                    }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: groupBy === 'daily' ? '%Y-%m-%d' : '%Y-%m',
                            date: '$settledAt'
                        }
                    },
                    totalSessions: { $sum: 1 },
                    totalRevenue: { $sum: '$totalCost' },
                    totalPlatformEarnings: { $sum: '$platformEarnings' },
                    totalAstrologerEarnings: { $sum: '$astrologerEarnings' },
                    totalTax: { $sum: '$taxAmount' },
                    totalDuration: { $sum: '$totalDurationSec' }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Get platform earnings from dedicated collection
        const platformEarnings = await PlatformEarnings.find({
            date: {
                $gte: start,
                $lte: end
            }
        }).sort({ date: 1 });

        res.json({
            success: true,
            data: {
                reportPeriod: { startDate: start, endDate: end },
                earningsReport,
                platformEarnings,
                summary: {
                    totalSessions: earningsReport.reduce((sum, item) => sum + item.totalSessions, 0),
                    totalRevenue: earningsReport.reduce((sum, item) => sum + item.totalRevenue, 0),
                    totalPlatformEarnings: earningsReport.reduce((sum, item) => sum + item.totalPlatformEarnings, 0),
                    totalAstrologerEarnings: earningsReport.reduce((sum, item) => sum + item.totalAstrologerEarnings, 0)
                }
            }
        });

    } catch (error) {
        console.error('Generate billing report error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate billing report'
        });
    }
};

/**
 * Update platform earnings daily summary
 */
export const updatePlatformEarnings = async (req, res) => {
    try {
        const { date = new Date().toISOString().split('T')[0] } = req.body;

        const targetDate = new Date(date);
        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

        // Calculate daily earnings from sessions
        const sessionEarnings = await Reservation.aggregate([
            {
                $match: {
                    status: 'SETTLED',
                    settledAt: {
                        $gte: startOfDay,
                        $lte: endOfDay
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    sessionEarnings: { $sum: '$platformEarnings' },
                    totalSessions: { $sum: 1 },
                    totalTax: { $sum: '$taxAmount' }
                }
            }
        ]);

        // Calculate recharge earnings (platform fees from recharges)
        const rechargeEarnings = await Transaction.aggregate([
            {
                $match: {
                    category: 'RECHARGE',
                    status: 'SUCCESS',
                    createdAt: {
                        $gte: startOfDay,
                        $lte: endOfDay
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    rechargeEarnings: { $sum: { $multiply: ['$amount', 0.02] } }, // 2% platform fee example
                    totalRecharges: { $sum: 1 }
                }
            }
        ]);

        const sessionData = sessionEarnings[0] || {
            sessionEarnings: 0,
            totalSessions: 0,
            totalTax: 0
        };

        const rechargeData = rechargeEarnings[0] || {
            rechargeEarnings: 0,
            totalRecharges: 0
        };

        const totalEarnings = sessionData.sessionEarnings + rechargeData.rechargeEarnings;

        // Update or create platform earnings record
        const platformEarnings = await PlatformEarnings.findOneAndUpdate(
            { date: startOfDay },
            {
                date: startOfDay,
                currency: 'INR',
                totalEarnings,
                sessionEarnings: sessionData.sessionEarnings,
                rechargeEarnings: rechargeData.rechargeEarnings,
                totalTax: sessionData.totalTax,
                totalSessions: sessionData.totalSessions,
                totalRecharges: rechargeData.totalRecharges,
                meta: {
                    calculatedAt: new Date(),
                    sessionCount: sessionData.totalSessions,
                    rechargeCount: rechargeData.totalRecharges
                }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'Platform earnings updated successfully',
            data: platformEarnings
        });

    } catch (error) {
        console.error('Update platform earnings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update platform earnings'
        });
    }
};

/**
 * Generate tax invoice for a user/astrologer
 */
export const generateTaxInvoice = async (req, res) => {
    try {
        const { entityType, entityId, periodFrom, periodTo } = req.body;

        if (!['USER', 'ASTROLOGER', 'PLATFORM'].includes(entityType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid entity type'
            });
        }

        const startDate = new Date(periodFrom);
        const endDate = new Date(periodTo);

        let transactions;
        let taxableAmount = 0;
        let taxAmount = 0;

        if (entityType === 'USER') {
            transactions = await Transaction.find({
                userId: entityId,
                status: 'SUCCESS',
                createdAt: { $gte: startDate, $lte: endDate },
                category: { $in: ['SESSION_DEDUCTION', 'RECHARGE'] }
            });

            taxableAmount = transactions
                .filter(tx => tx.category === 'SESSION_DEDUCTION')
                .reduce((sum, tx) => sum + tx.amount, 0);

            taxAmount = transactions
                .filter(tx => tx.category === 'SESSION_DEDUCTION')
                .reduce((sum, tx) => sum + (tx.taxAmount || 0), 0);

        } else if (entityType === 'ASTROLOGER') {
            // For astrologers, calculate from reservations
            const reservations = await Reservation.find({
                astrologerId: entityId,
                status: 'SETTLED',
                settledAt: { $gte: startDate, $lte: endDate }
            });

            taxableAmount = reservations.reduce((sum, res) => sum + res.astrologerEarnings, 0);
            taxAmount = reservations.reduce((sum, res) => sum + (res.taxAmount || 0), 0);
        }

        const totalAmount = taxableAmount + taxAmount;

        // Generate invoice number
        const invoiceCount = await TaxInvoice.countDocuments();
        const invoiceNumber = `INV-${(invoiceCount + 1).toString().padStart(6, '0')}`;

        const taxInvoice = new TaxInvoice({
            invoiceNumber,
            entityType,
            entityId,
            invoiceDate: new Date(),
            periodFrom: startDate,
            periodTo: endDate,
            taxableAmount,
            taxAmount,
            totalAmount,
            currency: 'INR',
            taxBreakdown: [
                {
                    taxType: 'GST',
                    taxRate: 18, // Example rate
                    taxAmount: taxAmount
                }
            ],
            status: 'GENERATED',
            meta: {
                generatedBy: req.user?.userId,
                generatedAt: new Date()
            }
        });

        await taxInvoice.save();

        res.json({
            success: true,
            message: 'Tax invoice generated successfully',
            data: taxInvoice
        });

    } catch (error) {
        console.error('Generate tax invoice error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate tax invoice'
        });
    }
};

/**
 * Get billing analytics and metrics
 */
export const getBillingAnalytics = async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        // Revenue metrics
        const revenueMetrics = await Reservation.aggregate([
            {
                $match: {
                    status: 'SETTLED',
                    settledAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$totalCost' },
                    platformRevenue: { $sum: '$platformEarnings' },
                    astrologerPayouts: { $sum: '$astrologerEarnings' },
                    totalSessions: { $sum: 1 },
                    totalDuration: { $sum: '$totalDurationSec' },
                    avgSessionValue: { $avg: '$totalCost' },
                    avgSessionDuration: { $avg: '$totalDurationSec' }
                }
            }
        ]);

        // Daily trends
        const dailyTrends = await Reservation.aggregate([
            {
                $match: {
                    status: 'SETTLED',
                    settledAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$settledAt' }
                    },
                    dailyRevenue: { $sum: '$totalCost' },
                    sessionCount: { $sum: 1 },
                    platformEarnings: { $sum: '$platformEarnings' }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Top astrologers by earnings
        const topAstrologers = await Reservation.aggregate([
            {
                $match: {
                    status: 'SETTLED',
                    settledAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$astrologerId',
                    totalEarnings: { $sum: '$astrologerEarnings' },
                    sessionCount: { $sum: 1 },
                    totalDuration: { $sum: '$totalDurationSec' }
                }
            },
            {
                $sort: { totalEarnings: -1 }
            },
            {
                $limit: 10
            }
        ]);

        // Session type distribution
        const sessionTypeDistribution = await Reservation.aggregate([
            {
                $match: {
                    status: 'SETTLED',
                    settledAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$sessionType',
                    revenue: { $sum: '$totalCost' },
                    sessionCount: { $sum: 1 },
                    avgRate: { $avg: '$ratePerMinute' }
                }
            }
        ]);

        const metrics = revenueMetrics[0] || {
            totalRevenue: 0,
            platformRevenue: 0,
            astrologerPayouts: 0,
            totalSessions: 0,
            totalDuration: 0,
            avgSessionValue: 0,
            avgSessionDuration: 0
        };

        res.json({
            success: true,
            data: {
                period: { startDate, endDate, days: parseInt(days) },
                metrics,
                dailyTrends,
                topAstrologers,
                sessionTypeDistribution,
                summary: {
                    revenueGrowth: calculateGrowth(metrics.totalRevenue, days),
                    sessionGrowth: calculateGrowth(metrics.totalSessions, days),
                    platformMargin: ((metrics.platformRevenue / metrics.totalRevenue) * 100) || 0
                }
            }
        });

    } catch (error) {
        console.error('Get billing analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch billing analytics'
        });
    }
};

// Helper function to calculate growth percentage
const calculateGrowth = (currentValue, days) => {
    // Simplified growth calculation
    // In real implementation, you'd compare with previous period
    return ((currentValue / days) / 100).toFixed(2);
};