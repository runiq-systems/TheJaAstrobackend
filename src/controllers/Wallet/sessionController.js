// controllers/sessionController.js
import { Reservation, SessionRateConfig, Wallet, Transaction, BillingTick, generateTxId, calculateCommission } from '../../models/Wallet/AstroWallet.js';

export const initiateSession = async (req, res) => {
    try {
        const { userId } = req.user;
        const { astrologerId, sessionType, estimatedMinutes = 10, couponCode } = req.body;

        // Get astrologer's rate config
        const rateConfig = await SessionRateConfig.findOne({
            astrologerId,
            sessionType,
            isActive: true,
            effectiveFrom: { $lte: new Date() },
            $or: [
                { effectiveTo: null },
                { effectiveTo: { $gte: new Date() } }
            ]
        });

        if (!rateConfig) {
            return res.status(400).json({
                success: false,
                message: 'Astrologer not available for this session type'
            });
        }

        // Calculate estimated cost
        const estimatedCost = rateConfig.ratePerMinute * estimatedMinutes;

        // Check user wallet balance
        const wallet = await Wallet.findOne({ userId });
        if (!wallet) {
            return res.status(400).json({
                success: false,
                message: 'Wallet not found. Please recharge first.'
            });
        }

        const userBalance = wallet.balances.find(b => b.currency === rateConfig.currency);
        if (!userBalance || userBalance.available < estimatedCost) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance. Please recharge your wallet.'
            });
        }

        // Calculate commission
        const commissionDetails = await calculateCommission(
            astrologerId,
            sessionType,
            estimatedCost
        );

        // Create reservation
        const reservation = new Reservation({
            reservationId: generateTxId('RES'),
            userId,
            astrologerId,
            sessionType,
            rateConfigId: rateConfig._id,
            ratePerMinute: rateConfig.ratePerMinute,
            currency: rateConfig.currency,
            commissionPercent: commissionDetails.finalCommissionPercent,
            commissionDetails,
            lockedAmount: estimatedCost,
            totalCost: estimatedCost,
            platformEarnings: commissionDetails.platformAmount,
            astrologerEarnings: commissionDetails.astrologerAmount,
            status: 'INITIATED',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes expiry
            meta: {
                estimatedMinutes,
                ipAddress: req.ip
            }
        });

        // Reserve amount in wallet
        const balanceIndex = wallet.balances.findIndex(b => b.currency === rateConfig.currency);
        wallet.balances[balanceIndex].available -= estimatedCost;
        wallet.balances[balanceIndex].locked += estimatedCost;
        wallet.lastBalanceUpdate = new Date();

        // Create reservation transaction
        const reservationTx = new Transaction({
            txId: generateTxId('RES'),
            userId,
            entityType: 'USER',
            entityId: userId,
            type: 'DEBIT',
            category: 'RESERVE',
            amount: estimatedCost,
            currency: rateConfig.currency,
            balanceBefore: userBalance.available,
            balanceAfter: userBalance.available - estimatedCost,
            status: 'SUCCESS',
            reservationId: reservation._id,
            description: `Amount reserved for session with astrologer`,
            processedAt: new Date(),
            completedAt: new Date()
        });

        await Promise.all([
            reservation.save(),
            wallet.save(),
            reservationTx.save()
        ]);

        res.json({
            success: true,
            message: 'Session initiated successfully',
            data: {
                reservationId: reservation.reservationId,
                astrologerId,
                sessionType,
                estimatedCost,
                lockedAmount: estimatedCost,
                expiresAt: reservation.expiresAt,
                nextStep: 'Connect to astrologer'
            }
        });
    } catch (error) {
        console.error('Initiate session error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const startSession = async (req, res) => {
    try {
        const { reservationId } = req.body;

        const reservation = await Reservation.findOne({ reservationId });
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        if (reservation.status !== 'INITIATED') {
            return res.status(400).json({
                success: false,
                message: 'Invalid reservation status'
            });
        }

        reservation.status = 'ONGOING';
        reservation.startAt = new Date();
        reservation.expiresAt = null; // Remove expiry once session starts

        await reservation.save();

        res.json({
            success: true,
            message: 'Session started successfully',
            data: {
                reservationId: reservation.reservationId,
                startAt: reservation.startAt,
                sessionType: reservation.sessionType
            }
        });
    } catch (error) {
        console.error('Start session error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const processBillingTick = async (req, res) => {
    try {
        const { reservationId, durationSec } = req.body;

        const reservation = await Reservation.findOne({ reservationId });
        if (!reservation || reservation.status !== 'ONGOING') {
            return res.status(400).json({
                success: false,
                message: 'Invalid session for billing'
            });
        }

        const minutes = durationSec / 60;
        const amount = reservation.ratePerMinute * minutes;
        const commissionAmount = (amount * reservation.commissionPercent) / 100;
        const astrologerAmount = amount - commissionAmount;

        // Create billing tick
        const billingTick = new BillingTick({
            reservationId: reservation._id,
            tickId: generateTxId('TICK'),
            tickAt: new Date(),
            minuteIndex: Math.floor(minutes),
            amount,
            commissionAmount,
            status: 'SUCCESS',
            meta: { durationSec }
        });

        // Update reservation totals
        reservation.totalDurationSec += durationSec;
        reservation.billedMinutes = Math.ceil(reservation.totalDurationSec / 60);
        reservation.totalCost += amount;
        reservation.platformEarnings += commissionAmount;
        reservation.astrologerEarnings += astrologerAmount;

        // Add to billing intervals
        reservation.billingIntervals.push({
            startTime: new Date(Date.now() - durationSec * 1000),
            endTime: new Date(),
            durationSec,
            amount
        });

        await Promise.all([reservation.save(), billingTick.save()]);

        res.json({
            success: true,
            message: 'Billing tick processed',
            data: {
                tickId: billingTick.tickId,
                amount,
                durationSec,
                totalBilled: reservation.totalCost
            }
        });
    } catch (error) {
        console.error('Billing tick error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const endSession = async (req, res) => {
    try {
        const { reservationId, finalDurationSec } = req.body;

        const reservation = await Reservation.findOne({ reservationId })
            .populate('rateConfigId');

        if (!reservation || reservation.status !== 'ONGOING') {
            return res.status(400).json({
                success: false,
                message: 'Invalid session for ending'
            });
        }

        const finalMinutes = finalDurationSec / 60;
        const finalAmount = reservation.ratePerMinute * finalMinutes;
        const finalCommission = (finalAmount * reservation.commissionPercent) / 100;
        const finalAstrologerAmount = finalAmount - finalCommission;

        // Update reservation with final amounts
        reservation.status = 'SETTLED';
        reservation.endAt = new Date();
        reservation.settledAt = new Date();
        reservation.totalDurationSec = finalDurationSec;
        reservation.billedMinutes = Math.ceil(finalMinutes);
        reservation.totalCost = finalAmount;
        reservation.platformEarnings = finalCommission;
        reservation.astrologerEarnings = finalAstrologerAmount;

        // Get user wallet
        const wallet = await Wallet.findOne({ userId: reservation.userId });
        const balanceIndex = wallet.balances.findIndex(b => b.currency === reservation.currency);

        // Calculate unused reserved amount
        const unusedAmount = reservation.lockedAmount - finalAmount;

        // Adjust wallet balances
        if (unusedAmount > 0) {
            // Unreserve unused amount
            wallet.balances[balanceIndex].locked -= unusedAmount;
            wallet.balances[balanceIndex].available += unusedAmount;

            // Create unreserve transaction
            const unreserveTx = new Transaction({
                txId: generateTxId('UNRES'),
                userId: reservation.userId,
                entityType: 'USER',
                entityId: reservation.userId,
                type: 'CREDIT',
                category: 'UNRESERVE',
                amount: unusedAmount,
                currency: reservation.currency,
                status: 'SUCCESS',
                reservationId: reservation._id,
                description: 'Unused session amount released',
                processedAt: new Date(),
                completedAt: new Date()
            });
            await unreserveTx.save();
        }

        // Create final session deduction transaction
        const sessionTx = new Transaction({
            txId: generateTxId('SESS'),
            userId: reservation.userId,
            entityType: 'USER',
            entityId: reservation.userId,
            type: 'DEBIT',
            category: 'SESSION_DEDUCTION',
            amount: finalAmount,
            currency: reservation.currency,
            commissionAmount: finalCommission,
            commissionRate: reservation.commissionPercent,
            status: 'SUCCESS',
            reservationId: reservation._id,
            description: `Session with astrologer - ${Math.ceil(finalMinutes)} minutes`,
            processedAt: new Date(),
            completedAt: new Date()
        });

        // Update wallet locked amount
        wallet.balances[balanceIndex].locked -= reservation.lockedAmount;
        wallet.balances[balanceIndex].locked += finalAmount; // Keep final amount locked until settlement
        wallet.lastBalanceUpdate = new Date();

        await Promise.all([
            reservation.save(),
            wallet.save(),
            sessionTx.save()
        ]);

        res.json({
            success: true,
            message: 'Session ended successfully',
            data: {
                reservationId: reservation.reservationId,
                totalCost: finalAmount,
                duration: finalDurationSec,
                platformEarnings: finalCommission,
                astrologerEarnings: finalAstrologerAmount
            }
        });
    } catch (error) {
        console.error('End session error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};