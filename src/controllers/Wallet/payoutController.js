// controllers/payoutController.js
import { Payout, Transaction, generateTxId,Reservation } from '../../models/Wallet/AstroWallet.js';
import { Astrologer } from '../../models/astrologer.js';
import mongoose from 'mongoose';

// Get payout accounts (bank details from Astrologer)
export const getPayoutAccounts = async (req, res) => {
    try {
        const userId = req.user.id;

        const astrologer = await Astrologer.findOne({ userId })
            .select('bankDetails')
            .lean();

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Filter active accounts and sort by primary first, then by creation date
        const activeAccounts = astrologer.bankDetails
            .filter(account => account.isActive !== false)
            .sort((a, b) => {
                // Sort by isPrimary (true first)
                if (b.isPrimary && !a.isPrimary) return 1;
                if (a.isPrimary && !b.isPrimary) return -1;
                // Then by creation date (newest first)
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

        res.json({
            success: true,
            data: {
                accounts: activeAccounts,
                count: activeAccounts.length
            }
        });
    } catch (error) {
        console.error('Get payout accounts error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Add bank account to astrologer
export const addBankAccount = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bankName, accountNumber, ifscCode, accountHolderName, branchName } = req.body;

        // Validation
        const requiredFields = ['bankName', 'accountNumber', 'ifscCode', 'accountHolderName'];
        const missingFields = requiredFields.filter(field => !req.body[field]);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        // IFSC code validation
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid IFSC code format'
            });
        }

        // Account number validation
        if (!/^\d{9,18}$/.test(accountNumber)) {
            return res.status(400).json({
                success: false,
                message: 'Account number must be 9-18 digits'
            });
        }

        // Find astrologer
        const astrologer = await Astrologer.findOne({ userId });
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Check if account number already exists
        const existingAccount = astrologer.bankDetails.find(
            acc => acc.accountNumber === accountNumber
        );

        if (existingAccount) {
            return res.status(400).json({
                success: false,
                message: 'Bank account already exists'
            });
        }

        // Check if this is the first account - make it primary
        const isFirstAccount = astrologer.bankDetails.length === 0;

        const newBankAccount = {
            bankName: bankName.trim(),
            accountNumber,
            ifscCode: ifscCode.toUpperCase().trim(),
            accountHolderName: accountHolderName.trim(),
            branchName: branchName?.trim(),
            isPrimary: isFirstAccount,
            isActive: true,
            verified: false,
            verifiedAt: null
        };

        // Add the new bank account
        astrologer.bankDetails.push(newBankAccount);
        await astrologer.save();

        res.status(201).json({
            success: true,
            message: 'Bank account added successfully',
            data: {
                account: newBankAccount,
                isPrimary: isFirstAccount
            }
        });
    } catch (error) {
        console.error('Add bank account error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Remove bank account from astrologer
export const removeBankAccount = async (req, res) => {
    try {
        const userId = req.user.id;
        const { accountId } = req.params;

        // Validate accountId
        if (!mongoose.Types.ObjectId.isValid(accountId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid account ID'
            });
        }

        const astrologer = await Astrologer.findOne({ userId });
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Find the account
        const accountIndex = astrologer.bankDetails.findIndex(
            acc => acc._id.toString() === accountId
        );

        if (accountIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Bank account not found'
            });
        }

        const accountToRemove = astrologer.bankDetails[accountIndex];

        // Check if there are pending payouts using this account
        const pendingPayout = await Payout.findOne({
            astrologerId: astrologer._id,
            bankAccountId: accountId,
            status: { $in: ['REQUESTED', 'PROCESSING', 'APPROVED'] }
        });

        if (pendingPayout) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete account with pending payouts'
            });
        }

        // Prevent removal of primary account if there are other active accounts
        if (accountToRemove.isPrimary) {
            const otherActiveAccounts = astrologer.bankDetails.filter(
                (acc, index) => index !== accountIndex && acc.isActive !== false
            );

            if (otherActiveAccounts.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot remove primary bank account. Set another account as primary first.'
                });
            }
        }

        // Remove the account
        astrologer.bankDetails.splice(accountIndex, 1);
        await astrologer.save();

        res.json({
            success: true,
            message: 'Bank account removed successfully',
            data: {
                removedAccountId: accountId
            }
        });
    } catch (error) {
        console.error('Remove bank account error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Set primary bank account
export const setPrimaryBankAccount = async (req, res) => {
    try {
        const userId = req.user.id;
        const { accountId } = req.params;

        // Validate accountId
        if (!mongoose.Types.ObjectId.isValid(accountId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid account ID'
            });
        }

        const astrologer = await Astrologer.findOne({ userId });
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Find the account
        const account = astrologer.bankDetails.find(
            acc => acc._id.toString() === accountId && acc.isActive !== false
        );

        if (!account) {
            return res.status(404).json({
                success: false,
                message: 'Active bank account not found'
            });
        }

        // Set all accounts to non-primary
        astrologer.bankDetails.forEach(acc => {
            acc.isPrimary = false;
        });

        // Set the selected account as primary
        account.isPrimary = true;
        await astrologer.save();

        res.json({
            success: true,
            message: 'Primary bank account updated successfully',
            data: {
                accountId: account._id,
                isPrimary: true
            }
        });
    } catch (error) {
        console.error('Set primary bank account error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Request payout
export const requestPayout = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user.id;
        const { amount, bankAccountId } = req.body;

        // Validate amount
        if (!amount || amount <= 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required'
            });
        }

        if (amount < 100) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Minimum payout amount is ₹100'
            });
        }

        // Find astrologer with bank details
        const astrologer = await Astrologer.findOne({ userId })
            .select('_id bankDetails')
            .session(session);

        if (!astrologer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Find the specified bank account
        const bankAccount = astrologer.bankDetails.find(
            acc => acc._id.toString() === bankAccountId && acc.isActive !== false
        );

        if (!bankAccount) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Active bank account not found'
            });
        }

        // Calculate available earnings from settled reservations
        const earningsData = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: 'SETTLED',
                    astrologerEarnings: { $gt: 0 }
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$astrologerEarnings' },
                    count: { $sum: 1 }
                }
            }
        ]).session(session);

        const totalEarnings = earningsData.length > 0 ? earningsData[0].totalEarnings : 0;

        // Calculate already requested but not processed payouts
        const pendingPayouts = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: '$amount' }
                }
            }
        ]).session(session);

        const totalPending = pendingPayouts.length > 0 ? pendingPayouts[0].totalPending : 0;
        const availableBalance = totalEarnings - totalPending;

        if (amount > availableBalance) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: `Insufficient balance. Available: ₹${availableBalance.toFixed(2)}`
            });
        }

        // Calculate fees
        const processingFee = Math.min(amount * 0.02, 50); // 2% or max ₹50
        const tds = amount * 0.05; // 5% TDS
        const netAmount = amount - processingFee - tds;

        // Create payout request
        const payout = new Payout({
            astrologerId: astrologer._id,
            amount,
            processingFee,
            tds,
            netAmount,
            currency: 'INR',
            status: 'REQUESTED',
            bankDetails: {
                bankName: bankAccount.bankName,
                accountNumber: bankAccount.accountNumber,
                ifscCode: bankAccount.ifscCode,
                accountHolderName: bankAccount.accountHolderName,
                branchName: bankAccount.branchName
            },
            bankAccountId: bankAccount._id,
            requestedAt: new Date(),
            meta: {
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            }
        });

        await payout.save({ session });

        // Create transaction record
        const transaction = new Transaction({
            txId: generateTxId('PYT'),
            userId: astrologer._id,
            entityType: 'ASTROLOGER',
            entityId: astrologer._id,
            type: 'PAYOUT_REQUEST',
            category: 'PAYOUT',
            amount: amount,
            netAmount: netAmount,
            currency: 'INR',
            fee: processingFee,
            tax: tds,
            status: 'PENDING',
            payoutId: payout._id,
            description: `Payout request of ₹${amount}`,
            processedAt: new Date(),
            meta: {
                bankName: bankAccount.bankName,
                last4Digits: bankAccount.accountNumber.slice(-4)
            }
        });

        await transaction.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            success: true,
            message: 'Payout request submitted successfully',
            data: {
                payoutId: payout._id,
                amount: amount,
                processingFee: processingFee,
                tds: tds,
                netAmount: netAmount,
                status: 'REQUESTED',
                estimatedProcessing: '3-5 business days',
                availableBalance: availableBalance - amount
            }
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        console.error('Request payout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get payout history
export const getPayoutHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 10, status, startDate, endDate } = req.query;

        // Find astrologer
        const astrologer = await Astrologer.findOne({ userId }).select('_id');
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Build filter
        const filter = { astrologerId: astrologer._id };
        if (status) filter.status = status;

        if (startDate || endDate) {
            filter.requestedAt = {};
            if (startDate) filter.requestedAt.$gte = new Date(startDate);
            if (endDate) filter.requestedAt.$lte = new Date(endDate);
        }

        // Get paginated payouts
        const payouts = await Payout.find(filter)
            .sort({ requestedAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .lean();

        // Get total count
        const total = await Payout.countDocuments(filter);

        // Calculate summary statistics
        const summary = await Payout.aggregate([
            {
                $match: { astrologerId: astrologer._id }
            },
            {
                $group: {
                    _id: '$status',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 },
                    avgAmount: { $avg: '$amount' }
                }
            }
        ]);

        // Calculate total earnings from settled reservations
        const earningsSummary = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: 'SETTLED'
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$astrologerEarnings' },
                    totalSessions: { $sum: 1 },
                    avgEarnings: { $avg: '$astrologerEarnings' }
                }
            }
        ]);

        // Calculate pending payout amount
        const pendingPayouts = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: '$amount' }
                }
            }
        ]);

        const totalEarnings = earningsSummary.length > 0 ? earningsSummary[0].totalEarnings : 0;
        const totalPending = pendingPayouts.length > 0 ? pendingPayouts[0].totalPending : 0;
        const availableBalance = totalEarnings - totalPending;

        res.json({
            success: true,
            data: {
                payouts,
                summary: {
                    byStatus: summary,
                    earnings: {
                        totalEarnings,
                        totalSessions: earningsSummary.length > 0 ? earningsSummary[0].totalSessions : 0,
                        avgEarnings: earningsSummary.length > 0 ? earningsSummary[0].avgEarnings : 0,
                        availableBalance,
                        pendingPayouts: totalPending
                    }
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
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

// Get payout details by ID
export const getPayoutDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        const { payoutId } = req.params;

        // Find astrologer
        const astrologer = await Astrologer.findOne({ userId }).select('_id');
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Find payout
        const payout = await Payout.findOne({
            _id: payoutId,
            astrologerId: astrologer._id
        }).lean();

        if (!payout) {
            return res.status(404).json({
                success: false,
                message: 'Payout not found'
            });
        }

        // Get related transaction
        const transaction = await Transaction.findOne({
            payoutId: payout._id,
            userId: astrologer._id
        }).lean();

        res.json({
            success: true,
            data: {
                payout,
                transaction
            }
        });
    } catch (error) {
        console.error('Get payout details error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Cancel payout request (only if status is REQUESTED)
export const cancelPayoutRequest = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user.id;
        const { payoutId } = req.params;

        // Find astrologer
        const astrologer = await Astrologer.findOne({ userId }).session(session);
        if (!astrologer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Find payout
        const payout = await Payout.findOne({
            _id: payoutId,
            astrologerId: astrologer._id
        }).session(session);

        if (!payout) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Payout not found'
            });
        }

        // Check if payout can be cancelled
        if (payout.status !== 'REQUESTED') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: `Payout cannot be cancelled. Current status: ${payout.status}`
            });
        }

        // Update payout status
        payout.status = 'CANCELLED';
        payout.cancelledAt = new Date();
        payout.cancelledBy = 'USER';
        payout.meta.cancellationReason = 'Cancelled by user';

        // Update related transaction
        await Transaction.findOneAndUpdate(
            { payoutId: payout._id },
            {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                description: `Payout request cancelled - ${payout.amount}`
            },
            { session }
        );

        await payout.save({ session });
        await session.commitTransaction();
        session.endSession();

        res.json({
            success: true,
            message: 'Payout request cancelled successfully',
            data: {
                payoutId: payout._id,
                status: payout.status
            }
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        console.error('Cancel payout request error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get payout statistics
export const getPayoutStatistics = async (req, res) => {
    try {
        const userId = req.user.id;

        // Find astrologer
        const astrologer = await Astrologer.findOne({ userId }).select('_id');
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: 'Astrologer not found'
            });
        }

        // Current month start and end
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // Calculate monthly statistics
        const monthlyStats = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: 'SUCCESS',
                    processedAt: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$amount' },
                    totalPayouts: { $sum: 1 },
                    totalFees: { $sum: '$processingFee' },
                    totalTDS: { $sum: '$tds' }
                }
            }
        ]);

        // Calculate lifetime statistics
        const lifetimeStats = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: 'SUCCESS'
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$amount' },
                    totalPayouts: { $sum: 1 },
                    totalFees: { $sum: '$processingFee' },
                    totalTDS: { $sum: '$tds' }
                }
            }
        ]);

        // Calculate earnings statistics
        const earningsStats = await Reservation.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: 'SETTLED'
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$astrologerEarnings' },
                    totalSessions: { $sum: 1 },
                    avgEarningsPerSession: { $avg: '$astrologerEarnings' }
                }
            }
        ]);

        // Calculate pending payout amount
        const pendingPayouts = await Payout.aggregate([
            {
                $match: {
                    astrologerId: astrologer._id,
                    status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPending: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const monthly = monthlyStats[0] || {
            totalAmount: 0,
            totalPayouts: 0,
            totalFees: 0,
            totalTDS: 0
        };

        const lifetime = lifetimeStats[0] || {
            totalAmount: 0,
            totalPayouts: 0,
            totalFees: 0,
            totalTDS: 0
        };

        const earnings = earningsStats[0] || {
            totalEarnings: 0,
            totalSessions: 0,
            avgEarningsPerSession: 0
        };

        const pending = pendingPayouts[0] || {
            totalPending: 0,
            count: 0
        };

        const availableBalance = earnings.totalEarnings - pending.totalPending;

        res.json({
            success: true,
            data: {
                monthly: {
                    payouts: monthly.totalAmount,
                    count: monthly.totalPayouts,
                    fees: monthly.totalFees,
                    tds: monthly.totalTDS
                },
                lifetime: {
                    payouts: lifetime.totalAmount,
                    count: lifetime.totalPayouts,
                    fees: lifetime.totalFees,
                    tds: lifetime.totalTDS,
                    netReceived: lifetime.totalAmount - lifetime.totalFees - lifetime.totalTDS
                },
                earnings: {
                    total: earnings.totalEarnings,
                    sessions: earnings.totalSessions,
                    averagePerSession: earnings.avgEarningsPerSession
                },
                pending: {
                    amount: pending.totalPending,
                    count: pending.count
                },
                availableBalance: availableBalance
            }
        });
    } catch (error) {
        console.error('Get payout statistics error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};