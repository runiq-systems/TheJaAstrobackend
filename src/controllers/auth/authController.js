import logger from "../../utils/logger.js";
import { User } from "../../models/user.js";
import { generateOtp, sendOtpEmail } from "../../utils/generateOtp.js";

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
  if (phoneRegex.test(phone)) {
    logger.warn(`Invalid phone format: ${phone}`);
    return res.status(400).json({
      success: false,
      message: "Invalid phone number format.",
    });
  }

  try {
    let currentUser = await User.findOne({ phone });
    // if (currentUser) {
    //   logger.warn("User exists in database");
    //   return res.status(401).json({
    //     success: false,
    //     message: "User Already exists!",
    //   });
    // }

    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    const otpSend = true; // changes will be done later on
    if (!otpSend) {
      throw new Error("Failed to send OTP. Please try again later.");
    }

    if (currentUser) {
      // Update existing currentUser with new OTP
      currentUser.otp = otp;
      currentUser.otpExpires = otpExpires;
      await currentUser.save();
      logger.info(`OTP resent to existing user: ${phone}`);
    } else {
      // Create new currentUser
      currentUser = new User({
        phone,
        otp,
        otpExpires,
        isVerified: false,
        UserStatus: "InActive",
      });
      await currentUser.save();
      logger.info(`New user registered: ${phone}`);
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
    logger.error(`Error from server in authController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server error" || error.message,
    });
  }
}