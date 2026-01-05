// routes/notification.routes.js
import express from "express";
import { User } from "../models/user.js";
import { sendNotification } from "../controllers/chatapp/chatSessionController.js";
import {
  adminMiddleware,
  authMiddleware,
} from "../middleware/authmiddleware.js";
import { createNotification, deleteNotification, getAllNotifications, getUnreadCount, getUserNotifications, markAllAsRead, markAsRead, updateNotification } from "../controllers/notification.controller.js";

const router = express.Router();

// router.post("/send-notification", sendNotification);

// routes/test.notification.js or directly in a controller
// router.post("/api/test-call-notification", async (req, res) => {
//   const { astrologerId } = req.body;

//   if (!astrologerId) {
//     return res.status(400).json({ error: "astrologerId required" });
//   }

//   try {
//     const astrologer = await User.findById(astrologerId).select("fullName deviceToken");
//     if (!astrologer || !astrologer.deviceToken) {
//       return res.status(404).json({ error: "Astrologer not found or no device token" });
//     }

//     // {
//     //     "astrologerId": "68fa7bc46d095190ea7269bb"
//     // }

//     // Use your FIXED sendNotification or sendCallNotification function here
//     await sendCallNotification({
//       userId: astrologerId,
//       requestId: "test-request-123",
//       sessionId: "test-session-456",
//       callType: "AUDIO",
//       callerId: "test-caller-999",
//       callerName: "Test User",
//       callerAvatar: "https://example.com/avatar.jpg",
//       ratePerMinute: 50,
//       expiresAt: new Date(Date.now() + 180000).toISOString(),
//     });

//     // OR if using the generic sendNotification:
//     // await sendNotification({
//     //   userId: astrologerId,
//     //   title: "Incoming Audio Call",
//     //   body: "Test User is calling you",
//     //   type: "incoming_call",
//     //   data: {
//     //     requestId: "test-123",
//     //     sessionId: "test-456",
//     //     callType: "AUDIO",
//     //     callerId: "test-caller",
//     //     callerName: "Test User",
//     //     callerAvatar: "",
//     //     screen: "Incomingcall",
//     //     event: "incoming",
//     //   },
//     // });

//     res.json({ success: true, message: "Test notification sent" });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });
// e.g., in routes/test.routes.js or directly in your main server file

router.post("/test-chat-notification", async (req, res) => {
  const {
    userId = "68fa7bc46d095190ea7269bb",
    title = "New Message",
    message = "You have a new chat message",
  } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required in body",
    });
  }

  try {
    // Optional: Validate user exists and has device token
    const user = await User.findById(userId).select("fullName deviceToken");
    if (!user || !user.deviceToken) {
      return res.status(404).json({
        success: false,
        message: "User not found or has no device token",
      });
    }

    // Send the chat notification
    await sendNotification({
      userId,
      title,
      message,
      type: "chat_message",
      data: {
        chatId: "test-chat-123",
        senderName: "Test User",
        senderId: "test-sender-999",
        senderAvatar: "https://example.com/avatar.jpg", // optional
        // Add any other data you want to test navigation with
      },
    });

    res.json({
      success: true,
      message: "Test chat notification sent successfully",
      targetUser: user.fullName || userId,
      deviceTokens: user.deviceToken,
    });
  } catch (error) {
    console.error("Test chat notification failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send notification",
      error: error.message,
    });
  }
});

router.get(
  "/my-notifications",
  authMiddleware,
  getUserNotifications
);
router.get(
  "/unread-count",
  authMiddleware,
  getUnreadCount
);
router.put("/mark-read/:id", authMiddleware, markAsRead);
router.put(
  "/mark-all-read",
  authMiddleware,
  markAllAsRead
);

// Admin routes
router.post("/", adminMiddleware, createNotification);
router.get("/", adminMiddleware, getAllNotifications);
router.put("/:id", adminMiddleware, updateNotification);
router.delete(
  "/:id",
  adminMiddleware,
  deleteNotification
);
export default router;
