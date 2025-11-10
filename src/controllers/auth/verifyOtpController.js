import { JWT_SECRET_KEY } from "../../config/constants.js";
import { User } from "../../models/user.js";
import logger from "../../utils/logger.js";
import jwt from "jsonwebtoken";

import admin from "../../utils/firabse.js";

export async function verifyOtpController(req, res) {
  const { phone, otp, deviceToken } = req.body;
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
    if (deviceToken) {
      currentUser.deviceToken = deviceToken;
      logger.info(`📱 Device token bound to user ${currentUser.phone}`);
    }
    await currentUser.save();


    try {
      await admin.app(); // ensures Firebase is initialized
      logger.info('🔥 Firebase app ready for notifications');
    } catch (e) {
      logger.warn('⚠️ Firebase not initialized:', e.message);
    }
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



export async function sendNotification(req, res) {
  try {
    const { userId, title, description } = req.body;
    // 1️⃣ Find user and check token
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      console.warn(`❌ No device token found for user ${userId}`);
      return;
    }

    const deviceToken = user.deviceToken;

    // 2️⃣ Prepare payload
    const message = {
      token: deviceToken,
      notification: {
        title,
        body: description,
      },
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title,
              body: description,
            },
            sound: "default",
          },
        },
      },
    };

    // 3️⃣ Send the notification
    const response = await admin.messaging().send(message);
    console.log("✅ Notification sent successfully:", response);

  } catch (error) {
    console.error("⚠️ Error sending notification:", error);

    // 4️⃣ Handle invalid or expired token
    if (error.errorInfo?.code === "messaging/registration-token-not-registered" ||
      error.errorInfo?.code === "messaging/invalid-registration-token") {
      console.warn("⚠️ Invalid token detected. Removing it from DB...");
      await User.findByIdAndUpdate(userId, { $unset: { deviceToken: 1 } });
    }
  }
}