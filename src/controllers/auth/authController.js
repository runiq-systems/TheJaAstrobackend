import logger from "../../utils/logger.js";
import { User } from "../../models/user.js";
import { generateOtp } from "../../utils/generateOtp.js";

export async function registerController(req, res) {
  const { phone } = req.body;

  if (!phone) {
    logger.warn("Phone number missing in request");
    return res.status(400).json({
      success: false,
      message: "Phone number is required.",
    });
  }

  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    logger.warn(`Invalid phone format: ${phone}`);
    return res.status(400).json({
      success: false,
      message: "Invalid phone number format.",
    });
  }

  try {
    let currentUser = await User.findOne({ phone });

    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (currentUser) {
      // User exists, update OTP
      currentUser.otp = otp;
      currentUser.otpExpires = otpExpires;
      await currentUser.save();
      logger.info(`OTP resent to existing user: ${phone}`);
    } else {
      // New user registration
      currentUser = new User({
        phone,
        otp,
        otpExpires,
        isVerified: false,
        userStatus: "InActive",
      });
      await currentUser.save();
      // logger.info(`New user registered: ${phone}`);
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully.",
      data: {
        phone: currentUser.phone,
        otpExpires: currentUser.otpExpires,
      },
    });
  } catch (error) {
    logger.error(`Error in registerController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}