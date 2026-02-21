import express from "express"
import { getProfileCompletionStatus, CheckKyc, adminregisterController, registerController, UpdateProfileStepController, adminGetUserProfile, UpdateProfileCompleteController, GetProfileController, LogoutController, updateUserProfile } from "../controllers/auth/authController.js"
import { verifyOtpController, updateDeviceToken } from "../controllers/auth/verifyOtpController.js"
import { authMiddleware } from "../middleware/authmiddleware.js"
import { registerLimiter, verifyOtpLimiter } from "../middleware/ratelimiter.js"
import { adminMiddleware } from "../middleware/authmiddleware.js"
import multer from "multer"
const router = express.Router()

router.post("/auth/register", registerLimiter, registerController);
router.post("/auth/adminregister", adminregisterController);
router.post(
  "/auth/verify-otp",
  verifyOtpLimiter,
  verifyOtpController
);
router.post("/auth/logout", authMiddleware, LogoutController)

// Step-wise profile update
router.patch("/profile/step/:step", authMiddleware, UpdateProfileStepController);

router.get("/profileStatus", authMiddleware, getProfileCompletionStatus);

// Complete profile update
// In your backend
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

router.patch('/profile', authMiddleware, upload.single('file'), UpdateProfileCompleteController);
router.get("/GetProfileController", authMiddleware, GetProfileController);

router.get("/admin/adminGetUserProfile/:userId", adminMiddleware, adminGetUserProfile);
router.put("/updateUserProfile/users", adminMiddleware, updateUserProfile);
// routes/astrologer.routes.js
router.get("/kyc/status", authMiddleware, CheckKyc);
router.post("/updateDeviceToken", authMiddleware, updateDeviceToken);


export default router
