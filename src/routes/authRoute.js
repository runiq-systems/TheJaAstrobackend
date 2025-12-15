import express from "express"
import { registerController, UpdateProfileStepController, UpdateProfileCompleteController, GetProfileController, LogoutController } from "../controllers/auth/authController.js"
import { verifyOtpController } from "../controllers/auth/verifyOtpController.js"
import { authMiddleware } from "../middleware/authmiddleware.js"
import { registerLimiter, verifyOtpLimiter } from "../middleware/ratelimiter.js"
const router = express.Router()

router.post("/auth/register", registerLimiter, registerController);
router.post(
  "/auth/verify-otp",
  verifyOtpLimiter,
  verifyOtpController
);router.post("/auth/logout",authMiddleware ,LogoutController)

// Step-wise profile update
router.patch("/profile/step/:step", authMiddleware, UpdateProfileStepController);

// Complete profile update
// In your backend
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.patch('/profile', upload.single('file'), UpdateProfileCompleteController);
router.get("/GetProfileController", authMiddleware, GetProfileController);


export default router