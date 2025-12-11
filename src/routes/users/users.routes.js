import express from "express";
import { getUserHistory } from "../../controllers/users/userHistory.controller.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";

const router = express.Router()

router.get("/history", authMiddleware, getUserHistory)

export default router