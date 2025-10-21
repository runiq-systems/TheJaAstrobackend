import express from "express"
import { registerController, UpdateProfileStepController, UpdateProfileCompleteController, GetProfileController, LogoutController } from "../controllers/auth/authController.js"
import { verifyOtpController } from "../controllers/auth/verifyOtpController.js"
import { authMiddleware } from "../middleware/authmiddleware.js"
const router = express.Router()

router.post("/auth/register", registerController)
router.post("/auth/verify-otp", verifyOtpController)
router.post("/auth/logout",authMiddleware ,LogoutController)

// Step-wise profile update
router.patch("/profile/step/:step", authMiddleware, UpdateProfileStepController);

// Complete profile update
router.patch("/profile", authMiddleware, UpdateProfileCompleteController);
router.get("/GetProfileController", authMiddleware, GetProfileController);


export default router