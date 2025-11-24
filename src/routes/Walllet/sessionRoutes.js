// routes/sessionRoutes.js
import express from 'express';

import {
    initiateSession,
    startSession,
    processBillingTick,
    endSession
} from '../../controllers/Wallet/sessionController.js';
import { authMiddleware } from '../../middleware/authmiddleware.js';

const router = express.Router();

router.post('/initiate', authMiddleware, initiateSession);
router.post('/start', authMiddleware, startSession);
router.post('/billing-tick', authMiddleware, processBillingTick);
router.post('/end', authMiddleware, endSession);

export default router;