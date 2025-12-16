// controllers/notification.controller.js
import { User } from "../models/user.js";
import admin from "../utils/firabse.js"; // firebase admin instance

export const sendNotification = async (req, res) => {
    try {
        const {
            phone,
            title = "Test Notification",
            body = "Hello from server 👋",
            type = "system",
        } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required",
            });
        }

        // 1️⃣ Find user by phone
        const user = await User.findOne({ phone }).select("deviceToken fullName");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        if (!user.deviceToken) {
            return res.status(400).json({
                success: false,
                message: "User has no device token",
            });
        }

        // 2️⃣ Prepare FCM payload
        const message = {
            token: user.deviceToken,

            notification: {
                title,
                body,
            },

            data: {
                type,
                screen: "Home",
            },

            android: {
                priority: "high",
                notification: {
                    sound: "default",
                    channelId: "default",
                },
            },

            apns: {
                payload: {
                    aps: {
                        sound: "default",
                    },
                },
            },
        };

        // 3️⃣ Send notification
        const response = await admin.messaging().send(message);

        return res.status(200).json({
            success: true,
            message: "Notification sent successfully",
            firebaseResponse: response,
        });
    } catch (error) {
        console.error("❌ sendNotification error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send notification",
        });
    }
};
