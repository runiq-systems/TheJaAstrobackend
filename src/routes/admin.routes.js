import express from 'express';
import { getDashboardStats } from '../controllers/admin/dashboard.controller.js';
import { getAllAdminUsers } from '../controllers/admin/user.controller.js';
import { getAllAdminAstrologers } from '../controllers/admin/astrologer.controller.js';

const router = express.Router();

router.get('/dashboard/stats', getDashboardStats);
router.get('/users/details', getAllAdminUsers)
router.get("/astrologers/details", getAllAdminAstrologers)

export default router;