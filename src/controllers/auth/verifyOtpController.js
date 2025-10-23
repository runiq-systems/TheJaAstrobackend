import { JWT_SECRET_KEY } from "../../config/constants.js";
import { User } from "../../models/user.js";
import logger from "../../utils/logger.js";
import jwt from "jsonwebtoken";

export async function verifyOtpController(req, res) {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    logger.warn("Missing fields required");
    return res.status(400).json({
      success: false,
      message: "Phone and OTP are required.",
    });
  }

  try {
    let currentUser = await User.findOne({ phone });
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (currentUser.otp !== otp && otp !== "1234") {
      // later on remove the hardcoded otp = 123456
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
      });
    }

    if (currentUser.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Please request again.",
      });
    }

    currentUser.isVerified = true;
    currentUser.userStatus = "Active";
    currentUser.otp = null;
    currentUser.otpExpires = null;

    const payload = { id: currentUser._id, phone: currentUser.phone };
    const token = jwt.sign(payload, JWT_SECRET_KEY);
    const refreshToken = jwt.sign(payload, JWT_SECRET_KEY);

    currentUser.refreshToken = refreshToken;

    await currentUser.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
      user: {
        token,
        refreshToken,
        data: {
          _id: currentUser._id,
          phone: currentUser.phone,
          isVerified: currentUser.isVerified,
        },
      },
    });
  } catch (error) {
    logger.error("Internal Error in verifyOtpController");
    return res.status(500).json({
      success: false,
      message: "Something went wrong" || error.message,
    });
  }
}
