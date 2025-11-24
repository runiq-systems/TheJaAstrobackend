// controllers/walletController.js
import { Wallet, Transaction, WalletAudit, generateTxId, toBaseUnits, fromBaseUnits } from '../../models/Wallet/AstroWallet.js';

export const getWalletBalance = async (req, res) => {
    try {
        const { userId } = req.user;

        const wallet = await Wallet.findOne({ userId })
            .populate('userId', 'name email phone');

        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }

        res.json({
            success: true,
            data: {
                walletId: wallet._id,
                balances: wallet.balances,
                status: wallet.status,
                tier: wallet.tier,
                lastUpdated: wallet.lastBalanceUpdate
            }
        });
    } catch (error) {
        console.error('Get wallet error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getTransactionHistory = async (req, res) => {
    try {
        const { userId } = req.user;
        const { page = 1, limit = 20, type, category, startDate, endDate } = req.query;

        const filter = { userId };
        if (type) filter.type = type;
        if (category) filter.category = category;
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const transactions = await Transaction.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('userId', 'name email')
            .lean();

        const total = await Transaction.countDocuments(filter);

        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Transaction history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const adminAdjustBalance = async (req, res) => {
    try {
        const { userId, amount, type, currency = 'INR', reason } = req.body;
        const adminId = req.user.userId;

        if (!userId || !amount || !type || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const wallet = await Wallet.findOne({ userId });
        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'User wallet not found'
            });
        }

        const txId = generateTxId('ADJ');
        const balanceIndex = wallet.balances.findIndex(b => b.currency === currency);
        const currentBalance = balanceIndex >= 0 ? wallet.balances[balanceIndex].available : 0;

        let newBalance;
        if (type === 'CREDIT') {
            newBalance = currentBalance + amount;
        } else if (type === 'DEBIT') {
            if (currentBalance < amount) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient balance'
                });
            }
            newBalance = currentBalance - amount;
        }

        // Create transaction
        const transaction = new Transaction({
            txId,
            userId,
            entityType: 'ADMIN',
            entityId: adminId,
            type,
            category: 'ADMIN_ADJUSTMENT',
            amount,
            currency,
            balanceBefore: currentBalance,
            balanceAfter: newBalance,
            status: 'SUCCESS',
            description: `Admin adjustment: ${reason}`,
            processedAt: new Date(),
            completedAt: new Date(),
            meta: { adminId, reason }
        });

        // Update wallet
        if (balanceIndex >= 0) {
            wallet.balances[balanceIndex].available = newBalance;
        } else {
            wallet.balances.push({
                currency,
                available: newBalance,
                bonus: 0,
                locked: 0,
                pendingIncoming: 0
            });
        }
        wallet.lastBalanceUpdate = new Date();

        // Create audit log
        const auditLog = new WalletAudit({
            userId,
            walletId: wallet._id,
            action: 'MANUAL_ADJUSTMENT',
            txId,
            changes: {
                available: { before: currentBalance, after: newBalance }
            },
            performedBy: 'ADMIN',
            performedById: adminId,
            note: reason,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        await Promise.all([
            wallet.save(),
            transaction.save(),
            auditLog.save()
        ]);

        res.json({
            success: true,
            message: 'Balance adjusted successfully',
            data: {
                transactionId: txId,
                newBalance: newBalance,
                currency
            }
        });
    } catch (error) {
        console.error('Admin adjust balance error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};  