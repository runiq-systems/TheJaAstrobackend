// controllers/payoutController.js
import { Payout, PayoutAccount, Transaction, Wallet, generateTxId,Reservation } from '../../models/Wallet/AstroWallet.js';
import mongoose from 'mongoose';
import { WalletService } from './walletIntegrationController.js';

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


/**
 * Request payout directly from wallet (no deductions)
 */
export const requestPayout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const astrologerId = req.user.id;
    const { amount, payoutAccountId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payout amount",
      });
    }

    // 🔹 Validate payout account
    const payoutAccount = await PayoutAccount.findOne({
      _id: payoutAccountId,
      astrologerId,
    }).session(session);

    if (!payoutAccount) {
      return res.status(404).json({
        success: false,
        message: "Payout account not found",
      });
    }

    if (!payoutAccount.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Payout account not verified",
      });
    }

    // ✅ Step 1: Debit from astrologer’s wallet (via WalletService)
    const { transaction } = await WalletService.debit({
      userId: astrologerId,
      amount,
      currency: "INR",
      category: "PAYOUT",
      description: `Withdrawal request of ₹${amount} initiated`,
      session,
    });

    // ✅ Step 2: Create payout record
    const payout = new Payout({
      astrologerId,
      amount,
      currency: "INR",
      fee: 0,
      tax: 0,
      netAmount: amount,
      method: payoutAccount.accountType === "UPI" ? "UPI" : "BANK_TRANSFER",
      payoutAccount: payoutAccount._id,
      status: "REQUESTED",
      transactionIds: [transaction.txId],
      meta: { ipAddress: req.ip },
    });

    await payout.save({ session });

    // ✅ Step 3: Commit transaction
    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: "Withdrawal request submitted successfully",
      data: {
        payoutId: payout._id,
        transactionId: transaction.txId,
        amount,
        netAmount: amount,
        estimatedProcessing: "3-5 business days",
      },
    });
  } catch (error) {
    console.error("Withdrawal request error:", error);
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({
      success: false,
      message: "Internal server error during withdrawal",
      error: error.message,
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
                    astrologerId: new mongoose.Types.ObjectId(astrologerId),
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
                $match: { astrologerId:new mongoose.Types.ObjectId(astrologerId) }
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