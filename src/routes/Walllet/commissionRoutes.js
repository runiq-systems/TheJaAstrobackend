// routes/commissionRoutes.js
import express from 'express';
import {
    createCommissionRule,
    getCommissionRules,
    createCommissionOverride,
    getCommissionOverrides,
    batchUpdateCommission,
    updateCommissionValue,
    getAllCommissionValues
} from '../../controllers/Wallet/commissionController.js';
import { adminMiddleware } from '../../middleware/authmiddleware.js';
import { requireAdmin } from '../../middleware/authmiddleware.js';

const router = express.Router();

router.post('/rules', adminMiddleware, createCommissionRule);
router.get('/rules', adminMiddleware, getCommissionRules);
router.post('/overrides', adminMiddleware, createCommissionOverride);
router.get('/overrides', adminMiddleware, getCommissionOverrides);
router.post('/batch-update', adminMiddleware, batchUpdateCommission);


router.patch(
    '/commission-rules/:id/commission-value',
    adminMiddleware,
    // requireAdmin,
    updateCommissionValue
);

router.get(
    '/commission-rules/commission-values',
    adminMiddleware,
    // requireAdmin,
    getAllCommissionValues
);


export default router;