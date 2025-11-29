import mongoose from "mongoose";
import {
    Wallet,
    Transaction,
    Reservation,
    generateTxId,
    toBaseUnits,
    fromBaseUnits,
} from "../../models/Wallet/AstroWallet.js";
import { ApiError } from "../../utils/ApiError.js";
export class WalletService {
    /**
     * Credit amount to user's wallet
     */
    static async credit({
        userId,
        amount,
        currency = "INR",
        category,
        subcategory = null,
        description = null,
        gatewayRef = null,
        relatedTx = [],
        meta = {},
    }) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Validate amount
            if (amount <= 0) {
                throw new ApiError(400, "Credit amount must be positive");
            }

            // Get or create wallet
            let wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) {
                wallet = await Wallet.create(
                    [
                        {
                            userId,
                            balances: [
                                {
                                    currency,
                                    available: 0,
                                    bonus: 0,
                                    locked: 0,
                                    pendingIncoming: 0,
                                },
                            ],
                        },
                    ],
                    { session }
                );
                wallet = wallet[0];
            }

            // Find currency balance
            let currencyBalance = wallet.balances.find(
                (b) => b.currency === currency
            );
            if (!currencyBalance) {
                currencyBalance = {
                    currency,
                    available: 0,
                    bonus: 0,
                    locked: 0,
                    pendingIncoming: 0,
                };
                wallet.balances.push(currencyBalance);
            }

            const balanceBefore = currencyBalance.available;
            const balanceAfter = balanceBefore + amount;

            // Create transaction record
            const transaction = await Transaction.create(
                [
                    {
                        txId: generateTxId("CREDIT"),
                        userId,
                        entityType: "USER",
                        entityId: userId,
                        type: "CREDIT",
                        category,
                        subcategory,
                        amount,
                        currency,
                        balanceBefore,
                        balanceAfter,
                        status: "SUCCESS",
                        description,
                        gatewayRef,
                        relatedTx,
                        processedAt: new Date(),
                        completedAt: new Date(),
                        meta,
                    },
                ],
                { session }
            );

            // Update wallet balance
            currencyBalance.available = balanceAfter;
            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            await session.commitTransaction();

            return {
                transaction: transaction[0],
                wallet,
                balanceBefore,
                balanceAfter,
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Debit amount from user's wallet
     */
    static async debit({
        userId,
        amount,
        currency = "INR",
        category,
        subcategory = null,
        description = null,
        reservationId = null,
        relatedTx = [],
        meta = {},
    }) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Validate amount
            if (amount <= 0) {
                throw new ApiError(400, "Debit amount must be positive");
            }

            // Get wallet
            const wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) {
                throw new ApiError(404, "Wallet not found");
            }

            // Find currency balance
            const currencyBalance = wallet.balances.find(
                (b) => b.currency === currency
            );
            if (!currencyBalance) {
                throw new ApiError(400, `No balance found for currency: ${currency}`);
            }

            // Check sufficient balance
            if (currencyBalance.available < amount) {
                throw new ApiError(400, "Insufficient balance");
            }

            const balanceBefore = currencyBalance.available;
            const balanceAfter = balanceBefore - amount;

            // Create transaction record
            const transaction = await Transaction.create(
                [
                    {
                        txId: generateTxId("DEBIT"),
                        userId,
                        entityType: "USER",
                        entityId: userId,
                        type: "DEBIT",
                        category,
                        subcategory,
                        amount,
                        currency,
                        balanceBefore,
                        balanceAfter,
                        status: "SUCCESS",
                        description,
                        reservationId,
                        relatedTx,
                        processedAt: new Date(),
                        completedAt: new Date(),
                        meta,
                    },
                ],
                { session }
            );

            // Update wallet balance
            currencyBalance.available = balanceAfter;
            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            await session.commitTransaction();

            return {
                transaction: transaction[0],
                wallet,
                balanceBefore,
                balanceAfter,
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Reserve amount for a session (move from available to locked)
     */
    static async reserveAmount({
        userId,
        amount,
        currency = "INR",
        reservationId,
        sessionType,
        description = "Session reservation",
    }) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Validate amount
            if (amount <= 0) {
                throw new ApiError(400, "Reservation amount must be positive");
            }

            // Get wallet
            const wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) {
                throw new ApiError(404, "Wallet not found");
            }

            // Find currency balance
            const currencyBalance = wallet.balances.find(
                (b) => b.currency === currency
            );
            if (!currencyBalance) {
                throw new ApiError(400, `No balance found for currency: ${currency}`);
            }

            // Check sufficient available balance
            if (currencyBalance.available < amount) {
                throw new ApiError(
                    400,
                    "Insufficient available balance for reservation"
                );
            }

            const availableBefore = currencyBalance.available;
            const lockedBefore = currencyBalance.locked;

            // Move amount from available to locked
            currencyBalance.available = availableBefore - amount;
            currencyBalance.locked = lockedBefore + amount;

            // Create reservation transaction
            const transaction = await Transaction.create(
                [
                    {
                        txId: generateTxId("RESERVE"),
                        userId,
                        entityType: "USER",
                        entityId: userId,
                        type: "DEBIT",
                        category: "RESERVE",
                        amount,
                        currency,
                        balanceBefore: availableBefore,
                        balanceAfter: currencyBalance.available,
                        status: "SUCCESS",
                        description,
                        reservationId,
                        processedAt: new Date(),
                        completedAt: new Date(),
                        meta: {
                            reservationId,
                            sessionType,
                            lockedAmount: currencyBalance.locked,
                        },
                    },
                ],
                { session }
            );

            // Update wallet
            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            await session.commitTransaction();

            return {
                transaction: transaction[0],
                wallet,
                availableBefore,
                availableAfter: currencyBalance.available,
                lockedBefore,
                lockedAfter: currencyBalance.locked,
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Release reserved amount (move from locked to available)
     */
    static async releaseAmount({
        userId,
        amount,
        currency = "INR",
        reservationId,
        description = "Session reservation release",
    }) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Get wallet
            const wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) {
                throw new ApiError(404, "Wallet not found");
            }

            // Find currency balance
            const currencyBalance = wallet.balances.find(
                (b) => b.currency === currency
            );
            if (!currencyBalance) {
                throw new ApiError(400, `No balance found for currency: ${currency}`);
            }

            // Check sufficient locked balance
            if (currencyBalance.locked < amount) {
                throw new ApiError(400, "Insufficient locked balance for release");
            }

            const availableBefore = currencyBalance.available;
            const lockedBefore = currencyBalance.locked;

            // Move amount from locked to available
            currencyBalance.locked = lockedBefore - amount;
            currencyBalance.available = availableBefore + amount;

            // Create release transaction
            const transaction = await Transaction.create(
                [
                    {
                        txId: generateTxId("UNRESERVE"),
                        userId,
                        entityType: "USER",
                        entityId: userId,
                        type: "CREDIT",
                        category: "UNRESERVE",
                        amount,
                        currency,
                        balanceBefore: availableBefore,
                        balanceAfter: currencyBalance.available,
                        status: "SUCCESS",
                        description,
                        reservationId,
                        processedAt: new Date(),
                        completedAt: new Date(),
                        meta: {
                            reservationId,
                            releasedAmount: amount,
                            remainingLocked: currencyBalance.locked,
                        },
                    },
                ],
                { session }
            );

            // Update wallet
            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            await session.commitTransaction();

            return {
                transaction: transaction[0],
                wallet,
                availableBefore,
                availableAfter: currencyBalance.available,
                lockedBefore,
                lockedAfter: currencyBalance.locked,
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Process session payment (transfer from user to platform/astrologer)
     */
    // Change the method to accept only reservationId (string or ObjectId)
    static async processSessionPayment(reservationId) {
        if (!reservationId || !mongoose.Types.ObjectId.isValid(reservationId)) {
            throw new ApiError(400, "Invalid reservation ID");
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const reservation = await Reservation.findById(reservationId)
                .populate("userId")
                .populate("astrologerId")
                .session(session);

            if (!reservation) {
                throw new ApiError(404, "Reservation not found");
            }

            if (reservation.status !== "SETTLING") {
                throw new ApiError(400, "Reservation is not in SETTLING state");
            }

            const totalCost = reservation.totalCost; // already calculated
            const platformEarnings = reservation.platformEarnings || 0;
            const astrologerEarnings = reservation.astrologerEarnings || totalCost * 0.8;

            // Debit user (from locked → deducted)
            await this.debit({
                userId: reservation.userId._id,
                amount: totalCost,
                currency: "INR",
                category: "SESSION_DEDUCTION",
                description: "Chat session payment",
                reservationId: reservation._id,
            });

            // Credit astrologer
            await this.credit({
                userId: reservation.astrologerId._id,
                amount: astrologerEarnings,
                currency: "INR",
                category: "EARNINGS",
                subcategory: "CHAT_SESSION",
                description: "Chat session earnings",
            });

            // Credit platform (optional)
            if (platformEarnings > 0) {
                // assuming you have a platform wallet user
                await this.credit({
                    userId: "PLATFORM_USER_ID", // or dynamic
                    amount: platformEarnings,
                    currency: "INR",
                    category: "COMMISSION",
                    description: "Platform commission",
                });
            }

            // Mark as settled
            reservation.status = "SETTLED";
            reservation.settledAt = new Date();
            await reservation.save({ session });

            await session.commitTransaction();

            return {
                success: true,
                totalCost,
                astrologerEarnings,
                platformEarnings,
            };

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Process recharge with bonus and coupon handling
     */
    static async processRecharge({
        userId,
        requestedAmount,
        currency = "INR",
        paymentGateway,
        gatewayTxnId,
        gatewayResponse = {},
        couponId = null,
        couponDiscount = 0,
    }) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Calculate bonus (example: 10% bonus on recharge)
            const bonusAmount = Math.round(requestedAmount * 0.1); // 10% bonus
            const finalAmount = requestedAmount + bonusAmount;

            // Create recharge record
            const recharge = await RechargeHistory.create(
                [
                    {
                        userId,
                        requestedAmount,
                        currency,
                        bonusAmount,
                        finalAmount,
                        paymentGateway,
                        gatewayTxnId,
                        gatewayResponse,
                        couponId,
                        couponDiscount,
                        status: "SUCCESS",
                        processedAt: new Date(),
                        completedAt: new Date(),
                    },
                ],
                { session }
            );

            // Credit main amount
            const mainCredit = await this.credit({
                userId,
                amount: requestedAmount,
                currency,
                category: "RECHARGE",
                description: `Wallet recharge via ${paymentGateway}`,
                gatewayRef: gatewayTxnId,
                meta: {
                    rechargeId: recharge[0]._id,
                    paymentGateway,
                    gatewayTxnId,
                },
            });

            // Credit bonus amount if any
            let bonusCredit = null;
            if (bonusAmount > 0) {
                bonusCredit = await this.credit({
                    userId,
                    amount: bonusAmount,
                    currency,
                    category: "BONUS",
                    subcategory: "RECHARGE_BONUS",
                    description: `Bonus on recharge`,
                    relatedTx: [mainCredit.transaction.txId],
                    meta: {
                        rechargeId: recharge[0]._id,
                        bonusType: "RECHARGE_BONUS",
                    },
                });
            }

            await session.commitTransaction();

            return {
                recharge: recharge[0],
                mainCredit,
                bonusCredit,
                totalCredited: finalAmount,
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get wallet balance
     */
    /**
     * Get detailed wallet balance with breakdown
     */
    static async getBalance(userId, currency = "INR") {
        try {
            const wallet = await Wallet.findOne({ userId });

            if (!wallet) {
                // Return zero balance if wallet doesn't exist
                return {
                    available: 0,
                    bonus: 0,
                    locked: 0,
                    pendingIncoming: 0,
                    total: 0,
                    currency: currency,
                    walletExists: false
                };
            }

            const balance = wallet.balances.find(b => b.currency === currency) || {
                available: 0,
                bonus: 0,
                locked: 0,
                pendingIncoming: 0
            };

            return {
                available: balance.available,
                bonus: balance.bonus,
                locked: balance.locked,
                pendingIncoming: balance.pendingIncoming || 0,
                total: balance.available + balance.bonus + (balance.pendingIncoming || 0),
                currency: currency,
                walletExists: true,
                lastUpdated: wallet.lastBalanceUpdate
            };
        } catch (error) {
            console.error('Error getting balance:', error);
            throw new ApiError(500, `Failed to get wallet balance: ${error.message}`);
        }
    }

    /**
     * Get transaction history
     */
    static async getTransactionHistory(userId, options = {}) {
        const {
            page = 1,
            limit = 10,
            type = null,
            category = null,
            startDate = null,
            endDate = null,
        } = options;

        const query = { userId };

        if (type) query.type = type;
        if (category) query.category = category;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const transactions = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const total = await Transaction.countDocuments(query);

        return {
            transactions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Check if user has sufficient balance for a transaction
     */
    static async checkBalance({
        userId,
        amount,
        currency = "INR",
        includeLocked = false, // Whether to consider locked balance as available
    }) {
        try {
            console.log(
                "💰 Checking balance for user:",
                userId,
                "Amount:",
                amount,
                "Currency:",
                currency
            );

            // Get wallet balance
            const balance = await this.getBalance(userId, currency);

            console.log("💰 Current balance:", balance);

            // Calculate available balance
            let availableBalance = balance.available;
            if (includeLocked) {
                availableBalance += balance.locked;
            }

            const hasSufficientBalance = availableBalance >= amount;

            console.log("💰 Balance check result:", {
                requestedAmount: amount,
                availableBalance: availableBalance,
                hasSufficientBalance: hasSufficientBalance,
                includeLocked: includeLocked,
            });

            return {
                hasSufficientBalance,
                availableBalance: availableBalance,
                currentBalance: balance,
                requestedAmount: amount,
                currency: currency,
                shortfall: hasSufficientBalance ? 0 : amount - availableBalance,
            };
        } catch (error) {
            console.error("❌ Error in checkBalance:", error);
            throw new ApiError(500, `Balance check failed: ${error.message}`);
        }
    }
}
