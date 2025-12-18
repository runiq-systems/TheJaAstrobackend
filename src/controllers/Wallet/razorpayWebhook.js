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
    const payment = event.payload.payment.entity;
    const orderId = payment.order_id;

    const recharge = await RechargeHistory.findOne({
        "meta.gateway.orderId": orderId,
    });

    if (!recharge) {
        console.warn("⚠️ Recharge not found for order:", orderId);
        return;
    }

    if (["SUCCESS", "SETTLED"].includes(recharge.status)) return;

    recharge.status = "SUCCESS";
    recharge.gatewayTxnId = payment.id;
    recharge.processedAt = new Date();

    recharge.gatewayResponse = {
        ...(recharge.gatewayResponse || {}),
        payment,
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

