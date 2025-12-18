import mongoose from "mongoose";


import {
    RechargeHistory,
    Wallet,
    Transaction,
    Ledger,
    WalletAudit,
    generateTxId,
} from "../models/Wallet/AstroWallet.js";
export const settleRecharge = async (rechargeId) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        /* ================= FETCH RECHARGE ================= */
        const recharge = await RechargeHistory
            .findById(rechargeId)
            .session(session);

        if (!recharge) {
            await session.abortTransaction();
            return;
        }

        // 🔒 Idempotency
        if (recharge.meta?.settled === true) {
            await session.abortTransaction();
            return;
        }

        if (recharge.status !== "SUCCESS") {
            await session.abortTransaction();
            return;
        }

        /* ================= WALLET (SAFE UPSERT) ================= */
        const wallet = await Wallet.findOneAndUpdate(
            { userId: recharge.userId },
            { $setOnInsert: { userId: recharge.userId, balances: [] } },
            { new: true, upsert: true, session }
        );

        let balance = wallet.balances.find(
            (b) => b.currency === recharge.currency
        );

        if (!balance) {
            balance = {
                currency: recharge.currency,
                available: 0,
                bonus: 0,
                locked: 0,
                pendingIncoming: 0,
            };
            wallet.balances.push(balance);
        }

        const beforeBalance = balance.available;

        // ✅ SAFE because inside Mongo transaction
        balance.available += recharge.finalAmount;
        balance.bonus += recharge.bonusAmount;

        wallet.lastBalanceUpdate = new Date();
        await wallet.save({ session });

        /* ================= TRANSACTION ================= */
        const txId = generateTxId("RCH");

        await Transaction.create(
            [{
                txId,
                userId: recharge.userId,
                entityType: "USER",
                entityId: recharge.userId,
                type: "CREDIT",
                category: "RECHARGE",
                amount: recharge.finalAmount,
                bonusAmount: recharge.bonusAmount,
                currency: recharge.currency,
                balanceBefore: beforeBalance,
                balanceAfter: balance.available,
                status: "SUCCESS",
                gatewayRef: recharge.gatewayTxnId,
                processedAt: new Date(),
                completedAt: new Date(),
            }],
            { session }
        );

        /* ================= LEDGER ================= */
        await Ledger.create(
            [{
                userId: recharge.userId,
                walletId: wallet._id,
                transactionId: txId,
                entryType: "credit",
                amount: recharge.finalAmount,
                beforeBalance,
                afterBalance: balance.available,
                description: "Wallet recharge",
            }],
            { session }
        );

        /* ================= WALLET AUDIT ================= */
        await WalletAudit.create(
            [{
                userId: recharge.userId,
                walletId: wallet._id,
                action: "BALANCE_UPDATE",
                txId,
                changes: {
                    available: { before: beforeBalance, after: balance.available },
                },
                performedBy: "SYSTEM",
                performedById: recharge.userId,
            }],
            { session }
        );

        /* ================= FINALIZE RECHARGE ================= */
        recharge.status = "SETTLED";
        recharge.transactionId = txId;
        recharge.completedAt = new Date();

        recharge.meta = {
            ...(recharge.meta || {}),
            settled: true,
            settlementAttempts: (recharge.meta?.settlementAttempts || 0) + 1,
            settledAt: new Date(),
        };

        await recharge.save({ session });

        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();

        await RechargeHistory.updateOne(
            { _id: rechargeId },
            {
                $inc: { "meta.settlementAttempts": 1 },
                $set: { "meta.lastSettlementError": error.message },
            }
        );

        throw error;
    } finally {
        session.endSession();
    }

};