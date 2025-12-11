// routes/payoutRoutes.js
import express from 'express';


import {
    getPayoutAccounts,
    addBankAccount,
    removeBankAccount,
    setPrimaryBankAccount,
    requestPayout,
    getPayoutHistory,
    getPayoutDetails,
    cancelPayoutRequest,
    getPayoutStatistics
} from '../../controllers/Wallet/payoutController.js';
import { authMiddleware } from '../../middleware/authmiddleware.js';
const router = express.Router();

router.use(authMiddleware);

router.get('/accounts', getPayoutAccounts);
router.post('/accounts', addBankAccount);
router.delete('/accounts/:accountId', removeBankAccount);
router.patch('/accounts/:accountId/primary', setPrimaryBankAccount);

// Payout management
router.post('/request', requestPayout);
router.get('/history', getPayoutHistory);
router.get('/:payoutId', getPayoutDetails);
router.delete('/:payoutId/cancel', cancelPayoutRequest);
router.get('/statistics/summary', getPayoutStatistics);


export default router;