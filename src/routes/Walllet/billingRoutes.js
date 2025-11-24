// routes/billingRoutes.js
import express from 'express';



import {
    processBillingTick,
    processBulkBillingTicks,
    getBillingHistory,
    handleFailedBillingTick,
    generateBillingReport,
    updatePlatformEarnings,
    generateTaxInvoice,
    getBillingAnalytics
} from '../../controllers/Wallet/billingController.js';
import { authMiddleware, adminMiddleware } from '../../middleware/authmiddleware.js';


const router = express.Router();

// Real-time billing endpoints
router.post('/tick', authMiddleware, processBillingTick);
router.post('/bulk-ticks', authMiddleware, processBulkBillingTicks);
router.post('/failed-tick/handle', authMiddleware, handleFailedBillingTick);

// Billing history and reports
router.get('/history/:reservationId', authMiddleware, getBillingHistory);
router.get('/report', adminMiddleware, generateBillingReport);
router.get('/analytics', adminMiddleware, getBillingAnalytics);

// Platform earnings management
router.post('/platform-earnings/update', adminMiddleware, updatePlatformEarnings);

// Tax invoice generation
router.post('/tax-invoice/generate', adminMiddleware, generateTaxInvoice);

export default router;