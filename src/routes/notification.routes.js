// routes/notification.routes.js
import express from "express";
import { sendNotification } from "../controllers/sendNotification.js";
import { User } from "../models/user.js";
import { sendCallNotification } from "../controllers/call/callSessionController.js";
const router = express.Router();

router.post("/send-notification", sendNotification);

// routes/test.notification.js or directly in a controller
router.post("/api/test-call-notification", async (req, res) => {
  const { astrologerId } = req.body;

  if (!astrologerId) {
    return res.status(400).json({ error: "astrologerId required" });
  }

  try {
    const astrologer = await User.findById(astrologerId).select("fullName deviceToken");
    if (!astrologer || !astrologer.deviceToken) {
      return res.status(404).json({ error: "Astrologer not found or no device token" });
    }

    // {
    //     "astrologerId": "68fa7bc46d095190ea7269bb"
    // }

    // Use your FIXED sendNotification or sendCallNotification function here
    await sendCallNotification({
      userId: astrologerId,
      requestId: "test-request-123",
      sessionId: "test-session-456",
      callType: "AUDIO",
      callerId: "test-caller-999",
      callerName: "Test User",
      callerAvatar: "https://example.com/avatar.jpg",
      ratePerMinute: 50,
      expiresAt: new Date(Date.now() + 180000).toISOString(),
    });

    // OR if using the generic sendNotification:
    // await sendNotification({
    //   userId: astrologerId,
    //   title: "Incoming Audio Call",
    //   body: "Test User is calling you",
    //   type: "incoming_call",
    //   data: {
    //     requestId: "test-123",
    //     sessionId: "test-456",
    //     callType: "AUDIO",
    //     callerId: "test-caller",
    //     callerName: "Test User",
    //     callerAvatar: "",
    //     screen: "Incomingcall",
    //     event: "incoming",
    //   },
    // });

    res.json({ success: true, message: "Test notification sent" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
