// routes/rechargeRoutes.js
import express from 'express';

import { initiateRecharge, 
    processRechargeCallback, 
    getRechargeHistory  } from '../../controllers/Wallet/rechargeController.js';
import { authMiddleware } from '../../middleware/authmiddleware.js';

const router = express.Router();

router.post('/initiate', authMiddleware, initiateRecharge);
router.post('/callback', processRechargeCallback); // Public route for payment gateway
router.get('/history', authMiddleware, getRechargeHistory);

export default router;