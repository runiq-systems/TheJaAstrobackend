import express from "express"
import { registerController } from "../controllers/auth/authController.js"
import { verifyOtpController } from "../controllers/auth/verifyOtpController.js"

const router = express.Router()

router.post("/auth/register", registerController)
router.post("/auth/verify-otp", verifyOtpController)

export default router