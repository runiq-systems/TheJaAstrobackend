import express from 'express';
import { getDashboardStats } from '../controllers/admin/dashboard.controller.js';
import { getAllAdminUsers } from '../controllers/admin/user.controller.js';
import { getAllAdminAstrologers } from '../controllers/admin/astrologer.controller.js';
import { getAllAdminCalls } from '../controllers/admin/call.controller.js';
import { getAllAdminChat } from '../controllers/admin/chat.controller.js';
import { getAllAdminTransactions } from '../controllers/admin/transactions.controller.js';
import { createCoupon, getAllAdminOffer } from '../controllers/admin/offers.controller.js';
import { getAdminPlatformReports } from '../controllers/admin/report.controller.js';
import { getAppSettings, getGlobalCommission, updateAppSettings } from '../controllers/admin/settings.controller.js';

const router = express.Router();

router.get('/dashboard/stats', getDashboardStats);
router.get('/users/details', getAllAdminUsers)
router.get("/astrologers/details", getAllAdminAstrologers)
router.get("/calls/details", getAllAdminCalls)
router.get('/chats/details', getAllAdminChat)
router.get("/transactions/all", getAllAdminTransactions)

router.get("/offer/coupon/all", getAllAdminOffer)
router.post("/offer/coupon/create", createCoupon)

router.get("/reports/stats", getAdminPlatformReports)

router.get("/settings/app-settings", getAppSettings)
router.patch("/settings/app-settings", updateAppSettings)

router.get("/settings/commission", getGlobalCommission)
export default router;