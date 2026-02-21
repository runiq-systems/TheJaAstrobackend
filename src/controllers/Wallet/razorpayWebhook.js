import crypto from "crypto";


import { RechargeHistory, CouponUsage } from "../../models/Wallet/AstroWallet.js";

export const razorpayWebhookHandler = async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    try {
        /* ================= VERIFY SIGNATURE ================= */
        const razorpaySignature = req.headers["x-razorpay-signature"];

        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(req.body)
            .digest("hex");

        if (razorpaySignature !== expectedSignature) {
            console.error("❌ Razorpay webhook signature mismatch");
            return res.status(401).send("Invalid signature");
        }

        const event = JSON.parse(req.body.toString());

        /* ================= ROUTE EVENTS ================= */
        switch (event.event) {
            case "payment.captured":
                await onPaymentCaptured(event);
                break;

            case "payment.failed":
                await onPaymentFailed(event);
                break;

            case "refund.processed":
                await onRefundProcessed(event);
                break;

            default:
                console.log("ℹ️ Unhandled Razorpay event:", event.event);
        }

        res.status(200).json({ status: "ok" });
    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).json({ success: false });
    }
};


const onPaymentCaptured = async (event) => {
    try {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;
        const GST_PERCENTAGE = 18; // Should be constant from your config

        console.log('Payment captured webhook:', {
            orderId,
            paymentId: payment.id,
            amount: payment.amount / 100, // Razorpay sends amount in paise
        });

        const recharge = await RechargeHistory.findOne({
            "meta.gateway.orderId": orderId,
        }).populate('userId'); // Populate user to update wallet

        if (!recharge) {
            console.warn("⚠️ Recharge not found for order:", orderId);
            return;
        }

        // Check if already processed
        if (["SUCCESS", "SETTLED", "COMPLETED"].includes(recharge.status)) {
            console.log("Recharge already processed:", recharge.status);
            return;
        }

        // Calculate amounts
        const totalPaid = recharge.amount; // This is what user paid including GST (e.g., ₹118)
        const baseAmount = totalPaid / (1 + GST_PERCENTAGE / 100); // Remove GST (e.g., ₹100)
        const gstAmount = totalPaid - baseAmount; // Calculate GST amount (e.g., ₹18)
        
        // Round to 2 decimal places
        const walletCreditAmount = Math.round(baseAmount * 100) / 100;
        const gstCollected = Math.round(gstAmount * 100) / 100;

        console.log('Webhook - Payment Breakdown:', {
            totalPaid,
            walletCreditAmount,
            gstCollected,
            gstPercentage: GST_PERCENTAGE
        });

        // Update recharge status
        recharge.status = "SUCCESS";
        recharge.gatewayTxnId = payment.id;
        recharge.processedAt = new Date();
        recharge.completedAt = new Date();

        // Store GST breakdown in gateway response
        recharge.gatewayResponse = {
            ...(recharge.gatewayResponse || {}),
            payment,
            gstBreakdown: {
                totalPaid,
                walletCreditAmount,
                gstAmount: gstCollected,
                gstPercentage: GST_PERCENTAGE
            }
        };

        recharge.meta = {
            ...(recharge.meta || {}),
            webhook: {
                received: true,
                lastEvent: "payment.captured",
                lastEventAt: new Date(),
            },
        };

        await recharge.save();

        /* ================= UPDATE WALLET ================= */
        // Update wallet with base amount (excluding GST)
        let wallet = await Wallet.findOne({ userId: recharge.userId });
        
        if (!wallet) {
            // Create new wallet if doesn't exist
            wallet = await Wallet.create({
                userId: recharge.userId._id || recharge.userId,
                balances: [{
                    currency: recharge.currency || 'INR',
                    available: walletCreditAmount,
                    bonus: 0,
                    locked: 0,
                    pendingIncoming: 0,
                }],
                lastBalanceUpdate: new Date()
            });
            console.log('New wallet created for user:', recharge.userId);
        } else {
            // Update existing wallet
            const bal = wallet.balances.find(b => b.currency === (recharge.currency || 'INR'));
            if (bal) {
                bal.available += walletCreditAmount;
                console.log(`Wallet updated: Added ₹${walletCreditAmount} to existing balance`);
            } else {
                wallet.balances.push({
                    currency: recharge.currency || 'INR',
                    available: walletCreditAmount,
                    bonus: 0,
                    locked: 0,
                    pendingIncoming: 0,
                });
                console.log(`New currency balance added: ₹${walletCreditAmount}`);
            }
            wallet.lastBalanceUpdate = new Date();
            await wallet.save();
        }

        /* ================= CREATE TRANSACTION RECORD ================= */
        await Transaction.create({
            txId: generateTxId("RCH"),
            userId: recharge.userId._id || recharge.userId,
            entityType: "USER",
            entityId: recharge.userId._id || recharge.userId,
            type: "CREDIT",
            category: "RECHARGE",
            amount: walletCreditAmount, // Credit amount (excluding GST)
            currency: recharge.currency || 'INR',
            status: "SUCCESS",
            gatewayRef: payment.id,
            meta: { 
                rechargeId: recharge._id,
                orderId: orderId,
                totalPaid: totalPaid,
                gstAmount: gstCollected,
                gstPercentage: GST_PERCENTAGE
            },
            description: `Wallet recharge - Credited ₹${walletCreditAmount} (Incl. ${GST_PERCENTAGE}% GST)`
        });

        console.log(`✅ Webhook processed successfully for recharge ${recharge._id}:`, {
            creditedToWallet: walletCreditAmount,
            gstCollected: gstCollected,
            totalPaid: totalPaid
        });

    } catch (error) {
        console.error("❌ Error in onPaymentCaptured webhook:", error);
        
        // Optional: Implement retry logic or send to error queue
        // You might want to store failed webhooks for manual processing
        await FailedWebhook.create({
            event: event,
            error: error.message,
            stack: error.stack,
            processedAt: new Date()
        }).catch(console.error);
    }
};

// Helper function to generate transaction ID (if not already defined)
const generateTxId = (prefix) => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${timestamp}${random}`;
};



const onPaymentFailed = async (event) => {
    const payment = event.payload.payment.entity;
    const orderId = payment.order_id;

    const recharge = await RechargeHistory.findOne({
        "meta.gateway.orderId": orderId,
    });

    if (!recharge) return;

    if (!["INITIATED", "PENDING"].includes(recharge.status)) return;

    recharge.status = "FAILED";
    recharge.processedAt = new Date();

    recharge.gatewayResponse = {
        ...(recharge.gatewayResponse || {}),
        payment,
    };

    recharge.meta = {
        ...(recharge.meta || {}),
        webhook: {
            received: true,
            lastEvent: "payment.failed",
            lastEventAt: new Date(),
        },
    };

    await recharge.save();

    if (recharge.couponId) {
        await CouponUsage.findOneAndUpdate(
            { rechargeId: recharge._id },
            { status: "REVOKED" }
        );
    }
};



const onRefundProcessed = async (event) => {
    const refund = event.payload.refund.entity;

    const recharge = await RechargeHistory.findOne({
        gatewayTxnId: refund.payment_id,
    });

    if (!recharge) return;

    recharge.status =
        refund.amount < recharge.finalAmount * 100
            ? "PARTIALLY_REFUNDED"
            : "REFUNDED";

    recharge.gatewayResponse = {
        ...(recharge.gatewayResponse || {}),
        refund,
    };

    recharge.meta = {
        ...(recharge.meta || {}),
        webhook: {
            received: true,
            lastEvent: "refund.processed",
            lastEventAt: new Date(),
        },
    };

    await recharge.save();
};

