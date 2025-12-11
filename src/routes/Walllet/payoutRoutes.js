// routes/payoutRoutes.js
import express from 'express';


import {
    getPayoutAccounts,
    addPayoutAccount,
    requestPayout,
    getPayoutHistory,
    processPayout
} from '../../controllers/Wallet/payoutController.js';
import { authMiddleware,adminMiddleware } from '../../middleware/authmiddleware.js';
const router = express.Router();

// Astrologer routes
router.get('/accounts', authMiddleware, getPayoutAccounts);
router.post('/accounts', authMiddleware, addPayoutAccount);
router.post('/request', authMiddleware, requestPayout);
router.get('/history', authMiddleware, getPayoutHistory);

// Admin routes
router.post('/admin/process/:payoutId', adminMiddleware, processPayout);

export default router;