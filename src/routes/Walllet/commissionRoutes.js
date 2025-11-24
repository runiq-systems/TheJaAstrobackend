// routes/commissionRoutes.js
import express from 'express';
import {
    createCommissionRule,
    getCommissionRules,
    createCommissionOverride,
    getCommissionOverrides,
    batchUpdateCommission
} from '../../controllers/Wallet/commissionController.js';
import {  adminMiddleware} from '../../middleware/authmiddleware.js';

const router = express.Router();

router.post('/rules', adminMiddleware, createCommissionRule);
router.get('/rules', adminMiddleware, getCommissionRules);
router.post('/overrides', adminMiddleware, createCommissionOverride);
router.get('/overrides', adminMiddleware, getCommissionOverrides);
router.post('/batch-update', adminMiddleware, batchUpdateCommission);

export default router;