import express from "express";
import { getDashboardStats } from "../controllers/admin/dashboard.controller.js";
import {
  freezeWallet,
  blockWallet,
  unblockWallet,
  getAllAdminUsers,
  getUserKundaliReports,
  getUserKundaliMatchings,
  updateUserStatus,
  addFundsManually,
  updateUser,
} from "../controllers/admin/user.controller.js";
import { getAllAdminAstrologers } from "../controllers/admin/astrologer.controller.js";
import { authMiddleware, requireAdmin } from "../middleware/authmiddleware.js";
import { createCoupon, getAllAdminOffer } from "../controllers/admin/offers.controller.js";
import { getAdminPlatformReports } from "../controllers/admin/report.controller.js";
import { getAppSettings, getGlobalCommission, updateAppSettings } from "../controllers/admin/settings.controller.js";
import { getAdminWallet } from "../controllers/admin/wallet.controller.js";
import {getAllAdminTransactions} from "../controllers/admin/transactions.controller.js"
import { getAllAdminCalls } from "../controllers/admin/call.controller.js";
import { getAllAdminChat } from "../controllers/admin/chat.controller.js";
import { createManualPayout, getPayouts } from "../controllers/admin/payouts.controller.js";

const router = express.Router();

router.get("/dashboard/stats", getDashboardStats);
router.get("/users/details", getAllAdminUsers);
router.get("/astrologers/details", getAllAdminAstrologers);
router.get("/transactions/all", getAllAdminTransactions)
router.get("/calls/details", getAllAdminCalls)
router.get("/chats/details", getAllAdminChat)

router.get("/offer/coupon/all", getAllAdminOffer);
router.post("/offer/coupon/create", createCoupon);

router.get("/reports/stats", getAdminPlatformReports);
router.get("/wallets/stats", getAdminWallet)

router.get("/settings/app-settings", getAppSettings);
router.patch("/settings/app-settings", updateAppSettings);
router.get("/settings/commission", getGlobalCommission);

router.get("/payouts/all", getPayouts)
router.post("/payouts/manual/create", createManualPayout)

router.get("/users/kundali-reports/:id", getUserKundaliReports);
router.get("/users/kundali-matchings/:id", getUserKundaliMatchings);

router.get("/users/updateUserStatus/:id", updateUserStatus);
router.put("/users/updateUser/:id", updateUser);
router.put("/users/addFundsManually/:id", addFundsManually);


router.post("/add-funds", authMiddleware, requireAdmin, addFundsManually);
// ❄️ Freeze wallet (temporary)
router.post("/freeze", authMiddleware, requireAdmin, freezeWallet);
// ⛔ Block wallet (permanent / compliance)
router.post("/block", authMiddleware, requireAdmin, blockWallet);
router.post("/unblockWallet", authMiddleware, requireAdmin, unblockWallet);

export default router;
