import express from 'express';
import { getDashboardStats } from '../controllers/admin/dashboard.controller.js';
import { freezeWallet, blockWallet, unblockWallet, getAllAdminUsers, getUserKundaliReports, getUserKundaliMatchings, updateUserStatus, addFundsManually, updateUser } from '../controllers/admin/user.controller.js';
import { getAllAdminAstrologers } from '../controllers/admin/astrologer.controller.js';
import { authMiddleware, requireAdmin } from '../middleware/authmiddleware.js';

const router = express.Router();

router.get('/dashboard/stats', getDashboardStats);
router.get('/users/details', getAllAdminUsers)
router.get("/astrologers/details", getAllAdminAstrologers)

router.get('/users/kundali-reports/:id', getUserKundaliReports);
router.get('/users/kundali-matchings/:id', getUserKundaliMatchings);
router.get('/users/updateUserStatus/:id', updateUserStatus);
router.put('/users/updateUser/:id', updateUser);
router.put('/users/addFundsManually/:id', addFundsManually);

router.post(
    "/add-funds",
    authMiddleware,
    requireAdmin,
    addFundsManually
);

// ❄️ Freeze wallet (temporary)
router.post(
    "/freeze",
    authMiddleware,
    requireAdmin,
    freezeWallet
);

// ⛔ Block wallet (permanent / compliance)
router.post(
    "/block",
    authMiddleware,
    requireAdmin,
    blockWallet
);
router.post(
    "/unblockWallet",
    authMiddleware,
    requireAdmin,
    unblockWallet
);

export default router;