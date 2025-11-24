// routes/walletRoutes.js
import express from 'express';

import { getWalletBalance, getTransactionHistory, adminAdjustBalance } from '../../controllers/Wallet/walletController.js';
import { authMiddleware, adminMiddleware } from '../../middleware/authmiddleware.js';
const router = express.Router();

// User routes
router.get('/balance', authMiddleware, getWalletBalance);
router.get('/transactions', authMiddleware, getTransactionHistory);

// Admin routes
router.post('/admin/adjust-balance', adminMiddleware, adminAdjustBalance);

export default router;