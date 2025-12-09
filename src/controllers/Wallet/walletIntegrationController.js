import mongoose from "mongoose";
import {
    Wallet,
    Transaction,
    Reservation,
    generateTxId,
    // toBaseUnits,
    // fromBaseUnits,
} from "../../models/Wallet/AstroWallet.js";
import { ApiError } from "../../utils/ApiError.js";
export class WalletService {
    /**
    * CREDIT - accepts optional mongoose session
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
        session: externalSession = null,
    }) {
        const ownSession = !externalSession;
        const session = externalSession || (await mongoose.startSession());

        try {
            if (ownSession) session.startTransaction();

            if (amount <= 0) throw new ApiError(400, "Credit amount must be positive");

            // Get or create wallet (using session)
            let wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) {
                const created = await Wallet.create(
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
                wallet = created[0];
            }

            // Find or create currency balance
            let currencyBalance = wallet.balances.find((b) => b.currency === currency);
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

            // Update wallet balances and save WITH session
            currencyBalance.available = balanceAfter;
            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            if (ownSession) await session.commitTransaction();

            return {
                transaction: transaction[0],
                wallet,
                balanceBefore,
                balanceAfter,
            };
        } catch (error) {
            if (ownSession) await session.abortTransaction();
            throw error;
        } finally {
            if (ownSession) session.endSession();
        }
    }

    /**
     * DEBIT - accepts optional mongoose session
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
        session: externalSession = null,
    }) {
        const ownSession = !externalSession;
        const session = externalSession || (await mongoose.startSession());

        try {
            if (ownSession) session.startTransaction();

            if (amount <= 0) throw new ApiError(400, "Debit amount must be positive");

            const wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) throw new ApiError(404, "Wallet not found");

            const currencyBalance = wallet.balances.find((b) => b.currency === currency);
            if (!currencyBalance) throw new ApiError(400, `No balance found for currency: ${currency}`);

            if (currencyBalance.available < amount) throw new ApiError(400, "Insufficient balance");

            const balanceBefore = currencyBalance.available;
            const balanceAfter = balanceBefore - amount;

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

            currencyBalance.available = balanceAfter;
            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            if (ownSession) await session.commitTransaction();

            return {
                transaction: transaction[0],
                wallet,
                balanceBefore,
                balanceAfter,
            };
        } catch (error) {
            if (ownSession) await session.abortTransaction();
            throw error;
        } finally {
            if (ownSession) session.endSession();
        }
    }

    /**
     * RESERVE AMOUNT - move available -> locked. Accepts optional session
     */
    static async reserveAmount({
        userId,
        amount,
        currency = "INR",
        reservationId,
        sessionType,
        description = "Session reservation",
        session: externalSession = null,
    }) {
        const ownSession = !externalSession;
        const session = externalSession || (await mongoose.startSession());

        try {
            if (ownSession) session.startTransaction();

            console.log(`[WALLET] RESERVE starting: User ${userId}, Amount ₹${amount}, Reservation ${reservationId}`);

            if (amount <= 0) throw new ApiError(400, "Reservation amount must be positive");

            const wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) throw new ApiError(404, "Wallet not found");

            const currencyBalance = wallet.balances.find((b) => b.currency === currency);
            if (!currencyBalance) throw new ApiError(400, `No balance found for currency: ${currency}`);

            console.log(`[WALLET] Before reserve - Available: ₹${currencyBalance.available}, Locked: ₹${currencyBalance.locked}`);

            if (currencyBalance.available < amount) {
                throw new ApiError(400, `Insufficient available balance. Available: ₹${currencyBalance.available}, Required: ₹${amount}`);
            }

            const availableBefore = currencyBalance.available;
            const lockedBefore = currencyBalance.locked;

            currencyBalance.available = availableBefore - amount;
            currencyBalance.locked = lockedBefore + amount;

            console.log(`[WALLET] After reserve - Available: ₹${currencyBalance.available}, Locked: ₹${currencyBalance.locked}`);
            console.log(`[WALLET] Change - Available: -₹${amount}, Locked: +₹${amount}`);

            const transaction = await Transaction.create(
                [
                    {
                        txId: generateTxId("RESERVE"),
                        userId,
                        entityType: "USER",
                        entityId: userId,
                        type: "DEBIT", // This should be DEBIT because we're moving from available
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

            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            if (ownSession) {
                await session.commitTransaction();
                console.log(`[WALLET] RESERVE committed successfully for user ${userId}`);
            }

            return {
                transaction: transaction[0],
                wallet,
                availableBefore,
                availableAfter: currencyBalance.available,
                lockedBefore,
                lockedAfter: currencyBalance.locked,
            };
        } catch (error) {
            if (ownSession) {
                await session.abortTransaction();
                console.error(`[WALLET] RESERVE failed for user ${userId}:`, error.message);
            }
            throw error;
        } finally {
            if (ownSession) session.endSession();
        }
    }

    /**
     * RELEASE AMOUNT - move locked -> available. Accepts optional session
     */
    // static async releaseAmount({
    //     userId,
    //     amount,
    //     currency = "INR",
    //     reservationId,
    //     description = "Session reservation release",
    //     session: externalSession = null,
    // }) {
    //     const ownSession = !externalSession;
    //     const session = externalSession || (await mongoose.startSession());

    //     try {
    //         if (ownSession) session.startTransaction();

    //         const wallet = await Wallet.findOne({ userId }).session(session);
    //         if (!wallet) throw new ApiError(404, "Wallet not found");

    //         const currencyBalance = wallet.balances.find((b) => b.currency === currency);
    //         if (!currencyBalance) throw new ApiError(400, `No balance found for currency: ${currency}`);

    //         if (currencyBalance.locked < amount) throw new ApiError(400, "Insufficient locked balance for release");

    //         const availableBefore = currencyBalance.available;
    //         const lockedBefore = currencyBalance.locked;

    //         currencyBalance.locked = lockedBefore - amount;
    //         currencyBalance.available = availableBefore + amount;

    //         const transaction = await Transaction.create(
    //             [
    //                 {
    //                     txId: generateTxId("UNRESERVE"),
    //                     userId,
    //                     entityType: "USER",
    //                     entityId: userId,
    //                     type: "CREDIT",
    //                     category: "UNRESERVE",
    //                     amount,
    //                     currency,
    //                     balanceBefore: availableBefore,
    //                     balanceAfter: currencyBalance.available,
    //                     status: "SUCCESS",
    //                     description,
    //                     reservationId,
    //                     processedAt: new Date(),
    //                     completedAt: new Date(),
    //                     meta: {
    //                         reservationId,
    //                         releasedAmount: amount,
    //                         remainingLocked: currencyBalance.locked,
    //                     },
    //                 },
    //             ],
    //             { session }
    //         );

    //         wallet.lastBalanceUpdate = new Date();
    //         await wallet.save({ session });

    //         if (ownSession) await session.commitTransaction();

    //         return {
    //             success: true,
    //             transaction: transaction[0],
    //             wallet,
    //             availableBefore,
    //             availableAfter: currencyBalance.available,
    //             lockedBefore,
    //             lockedAfter: currencyBalance.locked,
    //         };
    //     } catch (error) {
    //         if (ownSession) await session.abortTransaction();
    //         throw error;
    //     } finally {
    //         if (ownSession) session.endSession();
    //     }
    // }

    // In WalletService class, ensure releaseAmount works:


    // In WalletService class, ensure releaseAmount works:
    static async releaseAmount({
        userId,
        amount,
        currency = "INR",
        reservationId,
        description = "Session reservation release",
        session: externalSession = null,
    }) {
        const ownSession = !externalSession;
        const session = externalSession || (await mongoose.startSession());

        try {
            if (ownSession) session.startTransaction();

            console.log(`[WALLET] RELEASE starting: User ${userId}, Amount ₹${amount}, Currency ${currency}`);

            const wallet = await Wallet.findOne({ userId }).session(session);
            if (!wallet) throw new ApiError(404, "Wallet not found");

            const currencyBalance = wallet.balances.find((b) => b.currency === currency);
            if (!currencyBalance) throw new ApiError(400, `No balance found for currency: ${currency}`);

            console.log(`[WALLET] Before release - Available: ₹${currencyBalance.available}, Locked: ₹${currencyBalance.locked}`);

            if (currencyBalance.locked < amount) {
                console.warn(`[WALLET WARNING] Attempting to release ₹${amount} but only ₹${currencyBalance.locked} is locked. Releasing all locked.`);
                amount = currencyBalance.locked; // Release whatever is locked
            }

            const availableBefore = currencyBalance.available;
            const lockedBefore = currencyBalance.locked;

            currencyBalance.locked = lockedBefore - amount;
            currencyBalance.available = availableBefore + amount;

            console.log(`[WALLET] After release - Available: ₹${currencyBalance.available}, Locked: ₹${currencyBalance.locked}`);
            console.log(`[WALLET] Change - Available: +₹${amount}, Locked: -₹${amount}`);

            // FIX: This should be type: "CREDIT" because we're moving money from locked to available
            // But category should be "UNRESERVE" not "CREDIT" category
            const transaction = await Transaction.create(
                [
                    {
                        txId: generateTxId("UNLOCK"),
                        userId,
                        entityType: "USER",
                        entityId: userId,
                        type: "CREDIT", // FIX: This should be CREDIT for wallet operations
                        category: "UNRESERVE", // FIX: Category should be UNRESERVE
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
                            operation: "release_locked_to_available"
                        },
                    },
                ],
                { session }
            );

            wallet.lastBalanceUpdate = new Date();
            await wallet.save({ session });

            if (ownSession) {
                await session.commitTransaction();
                console.log(`[WALLET] RELEASE committed successfully for user ${userId}`);
            }

            return {
                success: true,
                transaction: transaction[0],
                wallet,
                availableBefore,
                availableAfter: currencyBalance.available,
                lockedBefore,
                lockedAfter: currencyBalance.locked,
            };
        } catch (error) {
            if (ownSession) {
                await session.abortTransaction();
                console.error(`[WALLET] RELEASE failed for user ${userId}:`, error.message);
            }
            throw error;
        } finally {
            if (ownSession) session.endSession();
        }
    }

    /**
     * Process session payment (settlement) - uses a single session for whole settlement
     */
    static async processSessionPayment(reservationId) {
        if (!reservationId || !mongoose.Types.ObjectId.isValid(reservationId)) {
            throw new ApiError(400, "Invalid reservation ID");
        }

        const maxRetries = 3;
        let attempts = 0;

        while (attempts < maxRetries) {
            const session = await mongoose.startSession();
            try {
                session.startTransaction();

                // Get reservation with session so we can update it atomically
                const reservation = await Reservation.findById(reservationId)
                    .populate("userId", "_id fullName")
                    .populate("astrologerId", "_id fullName")
                    .session(session);

                if (!reservation) throw new ApiError(404, "Reservation not found");

                const durationSeconds = reservation.totalDurationSec || 0;
                const billedMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
                const ratePerMinute = reservation.ratePerMinute || 0;
                const actualCost = billedMinutes * ratePerMinute;
                const platformEarnings = Math.round(actualCost * 0.20);
                const astrologerEarnings = actualCost - platformEarnings;
                const reservedAmount = reservation.lockedAmount || actualCost;
                const refundedAmount = Math.max(0, reservedAmount - actualCost);

                console.log(
                    `SETTLEMENT ATTEMPT ${attempts + 1}: Reserved ₹${reservedAmount} | Used ₹${actualCost} | Refund ₹${refundedAmount}`
                );

                // 1) Release the reserved amount back to user's available (locked -> available)
                await this.releaseAmount({
                    userId: reservation.userId._id,
                    amount: reservedAmount,
                    currency: "INR",
                    reservationId: reservation._id,
                    description: `Release reserved amount for settlement`,
                    session,
                });

                // 2) Debit the actual cost
                if (actualCost > 0) {
                    await this.debit({
                        userId: reservation.userId._id,
                        amount: actualCost,
                        currency: "INR",
                        category: "CHAT_SESSION",
                        subcategory: "SESSION_PAYMENT",
                        description: `Chat session: ${billedMinutes} min × ₹${ratePerMinute}/min`,
                        reservationId: reservation._id,
                        meta: { billedMinutes, actualCost, reservedAmount, refundedAmount },
                        session,
                    });
                }

                // 3) Credit astrologer earnings
                if (astrologerEarnings > 0 && reservation.astrologerId && reservation.astrologerId._id) {
                    await this.credit({
                        userId: reservation.astrologerId._id,
                        amount: astrologerEarnings,
                        currency: "INR",
                        category: "EARNINGS",
                        subcategory: "CHAT_SESSION",
                        description: `Earnings from ${billedMinutes} min chat`,
                        meta: { reservationId: reservation._id, billedMinutes, actualCost },
                        session,
                    });
                }

                // 4) Update reservation status & settlement meta
                reservation.status = "SETTLED";
                reservation.totalCost = actualCost;
                reservation.billedMinutes = billedMinutes;
                reservation.platformEarnings = platformEarnings;
                reservation.astrologerEarnings = astrologerEarnings;
                reservation.settledAt = new Date();
                reservation.refundedAmount = refundedAmount;
                await reservation.save({ session });

                await session.commitTransaction();

                const message =
                    refundedAmount > 0
                        ? `₹${actualCost} deducted. ₹${refundedAmount} refunded to your wallet.`
                        : "Full amount used.";

                return {
                    success: true,
                    actualCost,
                    billedMinutes,
                    refundedAmount,
                    reservedAmount,
                    message,
                };
            } catch (error) {
                await session.abortTransaction();

                // Heuristic for write conflicts (message or mongo code)
                const isWriteConflict =
                    error &&
                    (typeof error.message === "string" &&
                        (error.message.includes("Write conflict") ||
                            error.message.includes("WriteConflict") ||
                            error.message.includes("WriteConflictException"))) ||
                    (error && error.code && (error.code === 112 || error.code === 11000)); // optional

                if (isWriteConflict && attempts < maxRetries - 1) {
                    attempts++;
                    console.log(`Write conflict detected. Retrying... (${attempts}/${maxRetries})`);
                    await new Promise((r) => setTimeout(r, 200 * attempts)); // backoff
                    continue;
                }

                console.error("Settlement failed after retries:", error && (error.message || error));
                if (error instanceof ApiError) throw error;
                throw new ApiError(500, "Payment settlement failed: " + (error && error.message ? error.message : error));
            } finally {
                session.endSession();
            }
        }

        throw new ApiError(500, "Settlement failed after multiple attempts due to concurrent updates");
    }

    static async processSessionPayment(reservationId) {
        if (!reservationId || !mongoose.Types.ObjectId.isValid(reservationId)) {
            throw new ApiError(400, "Invalid reservation ID");
        }

        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const session = await mongoose.startSession();

            try {
                session.startTransaction();

                // Fetch inside the transaction
                const reservation = await Reservation.findById(reservationId)
                    .session(session)
                    .populate("userId", "_id fullName")
                    .populate("astrologerId", "_id fullName");

                if (!reservation) throw new ApiError(404, "Reservation not found");

                // Important Guard — Prevent double settlement
                if (reservation.status === "SETTLED") {
                    await session.abortTransaction();
                    return {
                        success: true,
                        message: "Reservation already settled",
                    };
                }

                const durationSeconds = reservation.totalDurationSec || 0;
                const billedMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
                const ratePerMinute = reservation.ratePerMinute || 0;
                const actualCost = billedMinutes * ratePerMinute;
                const platformEarnings = Math.round(actualCost * 0.20);
                const astrologerEarnings = actualCost - platformEarnings;
                const reservedAmount = reservation.lockedAmount || actualCost;
                const refundedAmount = Math.max(0, reservedAmount - actualCost);

                console.log(
                    `SETTLEMENT ATTEMPT ${attempt}: Reserved ₹${reservedAmount} | Used ₹${actualCost} | Refund ₹${refundedAmount}`
                );

                // Step 1: Release locked -> available
                await this.releaseAmount({
                    userId: reservation.userId._id,
                    amount: reservedAmount,
                    currency: "INR",
                    reservationId: reservation._id,
                    description: `Release reserved amount for settlement`,
                    session,
                });

                // Step 2: Debit actual cost
                if (actualCost > 0) {
                    await this.debit({
                        userId: reservation.userId._id,
                        amount: actualCost,
                        currency: "INR",
                        category: "CHAT_SESSION",
                        subcategory: "SESSION_PAYMENT",
                        description: `Chat session: ${billedMinutes} min × ₹${ratePerMinute}/min`,
                        reservationId: reservation._id,
                        meta: { billedMinutes, actualCost, reservedAmount, refundedAmount },
                        session,
                    });
                }

                // Step 3: Credit astrologer
                if (astrologerEarnings > 0 && reservation.astrologerId?._id) {
                    await this.credit({
                        userId: reservation.astrologerId._id,
                        amount: astrologerEarnings,
                        currency: "INR",
                        category: "EARNINGS",
                        subcategory: "CHAT_SESSION",
                        description: `Earnings from ${billedMinutes} min chat`,
                        meta: { reservationId: reservation._id, billedMinutes, actualCost },
                        session,
                    });
                }

                // Step 4: Update reservation
                reservation.status = "SETTLED";
                reservation.totalCost = actualCost;
                reservation.billedMinutes = billedMinutes;
                reservation.platformEarnings = platformEarnings;
                reservation.astrologerEarnings = astrologerEarnings;
                reservation.settledAt = new Date();
                reservation.refundedAmount = refundedAmount;

                await reservation.save({ session });

                await session.commitTransaction();

                return {
                    success: true,
                    actualCost,
                    billedMinutes,
                    refundedAmount,
                    reservedAmount,
                    message:
                        refundedAmount > 0
                            ? `₹${actualCost} deducted. ₹${refundedAmount} refunded.`
                            : "Full amount used.",
                };
            } catch (error) {
                await session.abortTransaction();

                // Official MongoDB retry check
                if (
                    error?.hasErrorLabel?.("TransientTransactionError") ||
                    error?.message?.includes("WriteConflict")
                ) {
                    console.log(`⛔ Write conflict — RETRY ${attempt}/${maxRetries}`);
                    if (attempt < maxRetries) {
                        await new Promise((r) => setTimeout(r, 200 * attempt));
                        continue;
                    }
                }

                console.error("Settlement failed:", error);
                throw new ApiError(500, `Payment settlement failed: ${error.message}`);
            } finally {
                session.endSession();
            }
        }

        throw new ApiError(500, "Settlement failed after multiple retries.");
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


    // Add this method to WalletService class
    static async cancelReservation(reservationId, session = null) {
        const ownSession = !session;
        const mongoSession = session || (await mongoose.startSession());

        try {
            if (ownSession) mongoSession.startTransaction();

            const reservation = await Reservation.findById(reservationId).session(mongoSession);
            if (!reservation) {
                console.log("Reservation not found for cancel:", reservationId);
                return { success: true, message: "Reservation already processed or not found" };
            }

            if (reservation.status !== "RESERVED") {
                console.log("Reservation already processed:", reservation.status);
                return { success: true, message: `Reservation already ${reservation.status}` };
            }

            const amount = reservation.lockedAmount || 0;

            if (amount > 0) {
                await this.releaseAmount({
                    userId: reservation.userId,
                    amount,
                    currency: reservation.currency || "INR",
                    reservationId: reservation._id,
                    description: "Call request expired/rejected/cancelled - full refund",
                    session: mongoSession,
                });
            }

            reservation.status = "CANCELLED";
            reservation.cancelledAt = new Date();
            reservation.refundedAmount = amount;
            await reservation.save({ session: mongoSession });

            if (ownSession) await mongoSession.commitTransaction();

            return { success: true, refundedAmount: amount };
        } catch (error) {
            if (ownSession) await mongoSession.abortTransaction();
            console.error("cancelReservation failed:", error);
            throw error;
        } finally {
            if (ownSession) mongoSession.endSession();
        }
    }
}
