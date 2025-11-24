// routes/couponRoutes.js
import express from 'express';

import {
    createCoupon,
    validateCoupon,
    getCoupons,
    updateCouponStatus
} from '../../controllers/Wallet/couponController.js';
import { authMiddleware,adminMiddleware  } from '../../middleware/authmiddleware.js';

const router = express.Router();

// User routes
router.post('/validate', authMiddleware, validateCoupon);

// Admin routes
router.post('/create', adminMiddleware, createCoupon);
router.get('/list', adminMiddleware, getCoupons);
router.put('/:couponId/status', adminMiddleware, updateCouponStatus);

export default router;