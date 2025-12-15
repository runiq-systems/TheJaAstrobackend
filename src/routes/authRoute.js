import express from "express"
import { registerController, UpdateProfileStepController, UpdateProfileCompleteController, GetProfileController, LogoutController } from "../controllers/auth/authController.js"
import { verifyOtpController } from "../controllers/auth/verifyOtpController.js"
import { authMiddleware } from "../middleware/authmiddleware.js"
import { registerLimiter, verifyOtpLimiter } from "../middleware/ratelimiter.js"
import multer from "multer"
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

router.patch('/profile',authMiddleware, upload.single('file'), UpdateProfileCompleteController);
router.get("/GetProfileController", authMiddleware, GetProfileController);


export default router