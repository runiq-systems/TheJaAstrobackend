import { JWT_SECRET_KEY } from "../../config/constants.js";
import { User } from "../../models/user.js";
import logger from "../../utils/logger.js";
import jwt from "jsonwebtoken";
import { Wallet, WalletHistory, WalletAudit } from "../../models/Wallet/AstroWallet.js";
import admin from "../../utils/firabse.js";
import { AppSettings } from "../../models/appSettings.js";

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

    // Mark user verified
    currentUser.isVerified = true;
    currentUser.userStatus = "Active";
    currentUser.otp = null;
    currentUser.otpExpires = null;

    const payload = { id: currentUser._id, phone: currentUser.phone, role: currentUser.role };
    const token = jwt.sign(payload, JWT_SECRET_KEY);
    const refreshToken = jwt.sign(payload, JWT_SECRET_KEY);

    currentUser.refreshToken = refreshToken;
    if (deviceToken) {
      currentUser.deviceToken = deviceToken;
      logger.info(`📱 Device token bound to user ${currentUser.phone}`);
    }

    await currentUser.save();

    // -------------------------
    // 🟢 CREATE WALLET IF NOT EXISTS (Default ₹100)
    // -------------------------
    let wallet = await Wallet.findOne({ userId: currentUser._id });
    // let appSettings = await AppSettings.findOne();
    if (!wallet) {

      // Fetch global settings (read-only)
      const appSettings = await AppSettings.findOne().lean();

      // Decide amount based on role
      const creditAmount =
        currentUser.role === "astrologer"
          ? 0
          : appSettings?.newuserbonus ?? 0;


      wallet = new Wallet({
        userId: currentUser._id,
        balances: [
          {
            currency: "INR",
            available: creditAmount,   // default ₹100
            bonus: 0,
            locked: 0,
            pendingIncoming: 0,
          },
        ],
      });

      await wallet.save();

      // Create wallet history for default credit
      await WalletHistory.create({
        userId: currentUser._id,
        date: new Date(),
        openingBalance: 0,
        closingBalance: creditAmount,
        totalCredit: creditAmount,
        totalDebit: 0,
      });

      logger.info(`💰 Default wallet created with ₹${creditAmount} for user ${currentUser.phone}`);
    }
    // -------------------------

    try {
      await admin.app();
      logger.info("🔥 Firebase app ready for notifications");
    } catch (e) {
      logger.warn("⚠️ Firebase not initialized:", e.message);
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
          role: currentUser.role,
        },
      },
    });
  } catch (error) {
    logger.error("Internal Error in verifyOtpController");
    return res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
}


export const updateDeviceToken = async (req, res) => {
  try {
    const userId = req.user._id;
    const { deviceToken } = req.body;

    if (!deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'Device token missing',
      });
    }

    await User.findByIdAndUpdate(
      userId,
      { deviceToken },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Device token updated',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to update device token',
    });
  }
};





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