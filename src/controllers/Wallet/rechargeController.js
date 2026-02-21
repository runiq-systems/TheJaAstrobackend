// controllers/rechargeController.js
import { RechargeHistory, Wallet, Transaction, Coupon, CouponUsage, generateTxId, toBaseUnits } from '../../models/Wallet/AstroWallet.js';
import Razorpay from "razorpay";
import crypto from "crypto";

export const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// export const initiateRecharge = async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const { amount, currency = "INR", paymentGateway, couponCode } = req.body;

//         if (!amount || amount <= 0) {
//             return res.status(400).json({ success: false, message: "Invalid amount" });
//         }

//         let coupon = null;
//         let couponDiscount = 0;
//         let bonusAmount = 0;
//         let finalAmount = amount;

//         /* ================= APPLY COUPON ================= */
//         if (couponCode) {
//             coupon = await Coupon.findOne({
//                 code: couponCode.toUpperCase(),
//                 isActive: true,
//                 startAt: { $lte: new Date() },
//                 $or: [{ endAt: null }, { endAt: { $gte: new Date() } }],
//             });

//             if (!coupon) {
//                 return res.status(400).json({ success: false, message: "Invalid or expired coupon" });
//             }

//             const usageCount = await CouponUsage.countDocuments({ couponId: coupon._id, userId });
//             if (coupon.perUserLimit && usageCount >= coupon.perUserLimit) {
//                 return res.status(400).json({ success: false, message: "Coupon usage limit exceeded" });
//             }

//             if (coupon.discountType === "PERCENTAGE") {
//                 couponDiscount = (amount * coupon.value) / 100;
//                 if (coupon.maxDiscount) {
//                     couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
//                 }
//             } else if (coupon.discountType === "FLAT_AMOUNT") {
//                 couponDiscount = coupon.value;
//             } else if (coupon.discountType === "BONUS_PERCENTAGE") {
//                 bonusAmount = (amount * coupon.value) / 100;
//             }

//             finalAmount = Math.max(amount - couponDiscount, 1);
//         }

//         /* ================= CREATE RECHARGE ================= */
//         const recharge = await RechargeHistory.create({
//             userId,
//             requestedAmount: amount,
//             finalAmount,
//             bonusAmount,
//             couponDiscount,
//             currency,
//             paymentGateway,
//             status: "INITIATED",
//             couponId: coupon?._id,
//             meta: {
//                 ipAddress: req.ip,
//                 userAgent: req.get("User-Agent"),
//             },
//         });

//         if (coupon) {
//             await CouponUsage.create({
//                 couponId: coupon._id,
//                 userId,
//                 rechargeId: recharge._id,
//                 discountAmount: couponDiscount,
//                 cartValue: amount,
//                 status: "APPLIED",
//             });
//         }

//         /* ================= CREATE RAZORPAY ORDER ================= */
//         if (paymentGateway === "RAZORPAY") {
//             const order = await razorpay.orders.create({
//                 amount: Math.round(finalAmount * 100), // paise
//                 currency: "INR",
//                 receipt: `rcpt_${recharge._id}`,
//                 notes: {
//                     rechargeId: recharge._id.toString(),
//                     userId,
//                 },
//             });

//             recharge.gatewayOrderId = order.id;
//             await recharge.save();

//             return res.json({
//                 success: true,
//                 data: {
//                     rechargeId: recharge._id,
//                     razorpayOrderId: order.id,
//                     razorpayKey: process.env.RAZORPAY_KEY_ID,
//                     amount: order.amount,
//                     currency: order.currency,
//                 },
//             });
//         }

//         return res.status(400).json({ success: false, message: "Unsupported payment gateway" });
//     } catch (error) {
//         console.error("Initiate recharge error:", error);
//         res.status(500).json({ success: false, message: "Internal server error" });
//     }
// };



// export const processRechargeCallback = async (req, res) => {
//     try {
//         const {
//             razorpay_order_id,
//             razorpay_payment_id,
//             razorpay_signature,
//             rechargeId,
//         } = req.body;

//         const recharge = await RechargeHistory.findById(rechargeId);
//         if (!recharge) {
//             return res.status(404).json({ success: false, message: "Recharge not found" });
//         }

//         if (recharge.status !== "INITIATED") {
//             return res.status(400).json({ success: false, message: "Recharge already processed" });
//         }

//         /* ================= VERIFY SIGNATURE ================= */
//         const body = `${razorpay_order_id}|${razorpay_payment_id}`;
//         const expectedSignature = crypto
//             .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
//             .update(body)
//             .digest("hex");

//         if (expectedSignature !== razorpay_signature) {
//             recharge.status = "FAILED";
//             await recharge.save();
//             return res.status(400).json({ success: false, message: "Payment verification failed" });
//         }

//         /* ================= SUCCESS ================= */
//         recharge.status = "SUCCESS";
//         recharge.gatewayTxnId = razorpay_payment_id;
//         recharge.completedAt = new Date();
//         await recharge.save();

//         /* ================= WALLET UPDATE ================= */
//         let wallet = await Wallet.findOne({ userId: recharge.userId });
//         if (!wallet) {
//             wallet = await Wallet.create({
//                 userId: recharge.userId,
//                 balances: [{
//                     currency: recharge.currency,
//                     available: recharge.finalAmount,
//                     bonus: recharge.bonusAmount,
//                     locked: 0,
//                     pendingIncoming: 0,
//                 }],
//             });
//         } else {
//             const bal = wallet.balances.find(b => b.currency === recharge.currency);
//             if (bal) {
//                 bal.available += recharge.finalAmount;
//                 bal.bonus += recharge.bonusAmount;
//             } else {
//                 wallet.balances.push({
//                     currency: recharge.currency,
//                     available: recharge.finalAmount,
//                     bonus: recharge.bonusAmount,
//                     locked: 0,
//                     pendingIncoming: 0,
//                 });
//             }
//             wallet.lastBalanceUpdate = new Date();
//             await wallet.save();
//         }

//         /* ================= TRANSACTION ================= */
//         await Transaction.create({
//             txId: generateTxId("RCH"),
//             userId: recharge.userId,
//             entityType: "USER",
//             entityId: recharge.userId,
//             type: "CREDIT",
//             category: "RECHARGE",
//             amount: recharge.finalAmount,
//             bonusAmount: recharge.bonusAmount,
//             currency: recharge.currency,
//             status: "SUCCESS",
//             gatewayRef: razorpay_payment_id,
//             meta: { rechargeId: recharge._id },
//         });

//         /* ================= COUPON USAGE ================= */
//         if (recharge.couponId) {
//             await CouponUsage.findOneAndUpdate(
//                 { rechargeId: recharge._id },
//                 { status: "USED", usedAt: new Date() }
//             );
//         }

//         return res.json({
//             success: true,
//             message: "Payment verified & recharge successful",
//         });
//     } catch (error) {
//         console.error("Verify payment error:", error);
//         res.status(500).json({ success: false, message: "Internal server error" });
//     }
// };


/* ============================================================
   INITIATE RECHARGE
   ============================================================ */
export const initiateRecharge = async (req, res) => {
    try {
        const userId = req.user.id;
        const { amount, currency = "INR", paymentGateway = "RAZORPAY", couponCode } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "Invalid amount" });
        }

        /* ================= PLATFORM FEE ================= */
        const PLATFORM_FEE_PERCENT = 18;

        const platformFee = (amount * PLATFORM_FEE_PERCENT) / 100;
        let finalAmount = amount - platformFee; // Wallet Credit Base

        if (finalAmount < 1) finalAmount = 1;

        let coupon = null;
        let couponDiscount = 0;
        let bonusAmount = 0;

        /* ================= APPLY COUPON ================= */
        if (couponCode) {
            coupon = await Coupon.findOne({
                code: couponCode.toUpperCase(),
                isActive: true,
                startAt: { $lte: new Date() },
                $or: [{ endAt: null }, { endAt: { $gte: new Date() } }],
            });

            if (!coupon) {
                return res.status(400).json({ success: false, message: "Invalid or expired coupon" });
            }

            const usageCount = await CouponUsage.countDocuments({ couponId: coupon._id, userId });

            if (coupon.perUserLimit && usageCount >= coupon.perUserLimit) {
                return res.status(400).json({ success: false, message: "Coupon usage limit exceeded" });
            }

            if (coupon.discountType === "PERCENTAGE") {
                couponDiscount = (finalAmount * coupon.value) / 100;

                if (coupon.maxDiscount) {
                    couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
                }
            }
            else if (coupon.discountType === "FLAT_AMOUNT") {
                couponDiscount = coupon.value;
            }
            else if (coupon.discountType === "BONUS_PERCENTAGE") {
                bonusAmount = (finalAmount * coupon.value) / 100;
            }

            finalAmount = Math.max(finalAmount - couponDiscount, 1);
        }

        /* ================= CREATE RECHARGE RECORD ================= */
        const recharge = await RechargeHistory.create({
            userId,
            requestedAmount: amount,
            platformFee,
            finalAmount,
            bonusAmount,
            couponDiscount,
            currency,
            paymentGateway,
            status: "INITIATED",
            couponId: coupon?._id,
            meta: {
                ipAddress: req.ip,
                userAgent: req.get("User-Agent"),
            },
        });

        if (coupon) {
            await CouponUsage.create({
                couponId: coupon._id,
                userId,
                rechargeId: recharge._id,
                discountAmount: couponDiscount,
                cartValue: amount,
                status: "APPLIED",
            });
        }

        /* ================= CREATE RAZORPAY ORDER ================= */
        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100), // FULL AMOUNT charged to user
            currency: "INR",
            receipt: `rcpt_${recharge._id}`,
            notes: {
                rechargeId: recharge._id.toString(),
                userId,
            },
        });

        recharge.gatewayOrderId = order.id;
        await recharge.save();

        return res.json({
            success: true,
            data: {
                rechargeId: recharge._id,
                razorpayOrderId: order.id,
                razorpayKey: process.env.RAZORPAY_KEY_ID,
                amount: order.amount,
                currency: order.currency,
            },
        });

    } catch (error) {
        console.error("Initiate recharge error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/* ============================================================
   VERIFY PAYMENT & CREDIT WALLET
   ============================================================ */
export const processRechargeCallback = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            rechargeId,
        } = req.body;

        const recharge = await RechargeHistory.findById(rechargeId);
        if (!recharge) {
            return res.status(404).json({ success: false, message: "Recharge not found" });
        }

        if (recharge.status !== "INITIATED") {
            return res.status(400).json({ success: false, message: "Recharge already processed" });
        }

        /* ================= VERIFY SIGNATURE ================= */
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;

        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            recharge.status = "FAILED";
            await recharge.save();
            return res.status(400).json({ success: false, message: "Payment verification failed" });
        }

        /* ================= SUCCESS ================= */
        recharge.status = "SUCCESS";
        recharge.gatewayTxnId = razorpay_payment_id;
        recharge.completedAt = new Date();
        await recharge.save();

        /* ================= WALLET CREDIT ================= */
        let wallet = await Wallet.findOne({ userId: recharge.userId });

        if (!wallet) {
            wallet = await Wallet.create({
                userId: recharge.userId,
                balances: [{
                    currency: recharge.currency,
                    available: recharge.finalAmount, // already 18% reduced
                    bonus: recharge.bonusAmount,
                    locked: 0,
                    pendingIncoming: 0,
                }],
            });
        } else {
            const bal = wallet.balances.find(b => b.currency === recharge.currency);

            if (bal) {
                bal.available += recharge.finalAmount;
                bal.bonus += recharge.bonusAmount;
            } else {
                wallet.balances.push({
                    currency: recharge.currency,
                    available: recharge.finalAmount,
                    bonus: recharge.bonusAmount,
                    locked: 0,
                    pendingIncoming: 0,
                });
            }

            wallet.lastBalanceUpdate = new Date();
            await wallet.save();
        }

        /* ================= TRANSACTION LOG ================= */
        await Transaction.create({
            txId: generateTxId("RCH"),
            userId: recharge.userId,
            entityType: "USER",
            entityId: recharge.userId,
            type: "CREDIT",
            category: "RECHARGE",
            amount: recharge.finalAmount,
            bonusAmount: recharge.bonusAmount,
            currency: recharge.currency,
            status: "SUCCESS",
            gatewayRef: razorpay_payment_id,
            meta: {
                rechargeId: recharge._id,
                requestedAmount: recharge.requestedAmount,
                platformFee: recharge.platformFee,
            },
        });

        /* ================= COUPON MARK USED ================= */
        if (recharge.couponId) {
            await CouponUsage.findOneAndUpdate(
                { rechargeId: recharge._id },
                { status: "USED", usedAt: new Date() }
            );
        }

        return res.json({
            success: true,
            message: "Recharge successful. 18% platform fee deducted.",
        });

    } catch (error) {
        console.error("Verify payment error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getRechargeHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, status } = req.query;

        const filter = { userId };
        if (status) filter.status = status;

        const recharges = await RechargeHistory.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('couponId', 'code name discountType value')
            .lean();

        const total = await RechargeHistory.countDocuments(filter);

        res.json({
            success: true,
            data: {
                recharges,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get recharge history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};