import express from "express";
import { razorpayWebhookHandler } from "../../controllers/Wallet/razorpayWebhook.js";
const router = express.Router();

router.post(
    "/razorpay/webhook",
    express.raw({ type: "application/json" }),
    razorpayWebhookHandler
);

export default router;
