// controllers/payoutController.js
import { Payout, PayoutAccount, Transaction, Wallet, generateTxId } from '../../models/Wallet/AstroWallet.js';

export const getPayoutAccounts = async (req, res) => {
    try {
        const astrologerId = req.user.id;

        const accounts = await PayoutAccount.find({ astrologerId })
            .sort({ isPrimary: -1, createdAt: -1 });

        res.json({
            success: true,
            data: { accounts }
        });
    } catch (error) {
        console.error('Get payout accounts error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const addPayoutAccount = async (req, res) => {
    try {
        const astrologerId = req.user.id;
        const {
            accountType, bankName, accountNumber, ifscCode,
            accountHolder, upiId, isPrimary = false
        } = req.body;

        // Validate required fields based on account type
        if (accountType === 'BANK' && (!bankName || !accountNumber || !ifscCode || !accountHolder)) {
            return res.status(400).json({
                success: false,
                message: 'Missing required bank account details'
            });
        }

        if (accountType === 'UPI' && !upiId) {
            return res.status(400).json({
                success: false,
                message: 'UPI ID is required'
            });
        }

        // If setting as primary, update existing primary accounts
        if (isPrimary) {
            await PayoutAccount.updateMany(
                { astrologerId, isPrimary: true },
                { isPrimary: false }
            );
        }

        const payoutAccount = new PayoutAccount({
            astrologerId,
            accountType,
            bankName,
            accountNumber,
            ifscCode,
            accountHolder,
            upiId,
            isPrimary,
            isVerified: false // Requires admin verification for bank accounts
        });

        await payoutAccount.save();

        res.status(201).json({
            success: true,
            message: 'Payout account added successfully',
            data: { account: payoutAccount }
        });
    } catch (error) {
        console.error('Add payout account error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const requestPayout = async (req, res) => {
    try {
        const astrologerId = req.user.id;
        const { amount, payoutAccountId } = req.body;

        // Get payout account
        const payoutAccount = await PayoutAccount.findOne({
            _id: payoutAccountId,
            astrologerId
        });

        if (!payoutAccount) {
            return res.status(404).json({
                success: false,
                message: 'Payout account not found'
            });
        }

        if (!payoutAccount.isVerified) {
            return res.status(400).json({
                success: false,
                message: 'Payout account not verified'
            });
        }

        // Calculate available earnings from successful sessions
        const completedSessions = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: mongoose.Types.ObjectId(astrologerId),
                    status: 'SETTLED',
                    settledAt: { $exists: true }
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$astrologerEarnings' }
                }
            }
        ]);

        const totalEarnings = completedSessions.length > 0 ? completedSessions[0].totalEarnings : 0;

        // Get already requested payouts
        const requestedPayouts = await Payout.aggregate([
            {
                $match: {
                    astrologerId: mongoose.Types.ObjectId(astrologerId),
                    status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalRequested: { $sum: '$amount' }
                }
            }
        ]);

        const totalRequested = requestedPayouts.length > 0 ? requestedPayouts[0].totalRequested : 0;
        const availableForPayout = totalEarnings - totalRequested;

        if (amount > availableForPayout) {
            return res.status(400).json({
                success: false,
                message: `Insufficient earnings. Available: ${availableForPayout}`
            });
        }

        // Calculate fees (example: 2% processing fee)
        const fee = amount * 0.02;
        const tax = 0; // Could be calculated based on tax rules
        const netAmount = amount - fee - tax;

        const payout = new Payout({
            astrologerId,
            amount,
            currency: 'INR',
            fee,
            tax,
            netAmount,
            method: payoutAccount.accountType === 'UPI' ? 'UPI' : 'BANK_TRANSFER',
            payoutAccount: payoutAccountId,
            status: 'REQUESTED',
            meta: { ipAddress: req.ip }
        });

        await payout.save();

        res.json({
            success: true,
            message: 'Payout request submitted successfully',
            data: {
                payoutId: payout._id,
                amount,
                fee,
                netAmount,
                estimatedProcessing: '3-5 business days'
            }
        });
    } catch (error) {
        console.error('Request payout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getPayoutHistory = async (req, res) => {
    try {
        const astrologerId  = req.user.id;
        const { page = 1, limit = 20, status } = req.query;

        const filter = { astrologerId };
        if (status) filter.status = status;

        const payouts = await Payout.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('payoutAccount')
            .lean();

        const total = await Payout.countDocuments(filter);

        // Calculate earnings summary
        const earningsSummary = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: mongoose.Types.ObjectId(astrologerId),
                    status: 'SETTLED'
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$astrologerEarnings' },
                    totalSessions: { $sum: 1 }
                }
            }
        ]);

        const payoutSummary = await Payout.aggregate([
            {
                $match: { astrologerId: mongoose.Types.ObjectId(astrologerId) }
            },
            {
                $group: {
                    _id: '$status',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                payouts,
                summary: {
                    totalEarnings: earningsSummary.length > 0 ? earningsSummary[0].totalEarnings : 0,
                    totalSessions: earningsSummary.length > 0 ? earningsSummary[0].totalSessions : 0,
                    payoutSummary
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get payout history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Admin functions
export const processPayout = async (req, res) => {
    try {
        const { payoutId } = req.params;
        const adminId = req.user.id;

        const payout = await Payout.findById(payoutId)
            .populate('payoutAccount')
            .populate('astrologerId');

        if (!payout) {
            return res.status(404).json({
                success: false,
                message: 'Payout not found'
            });
        }

        if (payout.status !== 'REQUESTED') {
            return res.status(400).json({
                success: false,
                message: 'Payout already processed'
            });
        }

        // Simulate payout processing
        payout.status = 'PROCESSING';
        payout.processedBy = adminId;
        payout.processedAt = new Date();

        // In real implementation, integrate with payment gateway here
        // For now, simulate successful processing after 2 seconds
        setTimeout(async () => {
            try {
                payout.status = 'SUCCESS';
                payout.settlementBatchId = generateTxId('BATCH');

                // Create platform transaction for payout
                const platformTx = new Transaction({
                    txId: generateTxId('POUT'),
                    userId: payout.astrologerId._id,
                    entityType: 'ASTROLOGER',
                    entityId: payout.astrologerId._id,
                    type: 'DEBIT',
                    category: 'PAYOUT',
                    amount: payout.amount,
                    currency: payout.currency,
                    fee: payout.fee,
                    tax: payout.tax,
                    status: 'SUCCESS',
                    payoutId: payout._id,
                    description: `Payout processed to ${payout.payoutAccount.accountType}`,
                    processedAt: new Date(),
                    completedAt: new Date(),
                    meta: {
                        settlementBatchId: payout.settlementBatchId,
                        processedBy: adminId
                    }
                });

                await Promise.all([payout.save(), platformTx.save()]);

            } catch (error) {
                console.error('Async payout processing error:', error);
                payout.status = 'FAILED';
                payout.failureReason = 'Processing error';
                await payout.save();
            }
        }, 2000);

        await payout.save();

        res.json({
            success: true,
            message: 'Payout processing initiated',
            data: { payoutId: payout._id, status: payout.status }
        });
    } catch (error) {
        console.error('Process payout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};