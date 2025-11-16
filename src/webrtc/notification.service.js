import admin from "firebase-admin";
import logger from "../utils/logger.js";
import { User } from "../models/user.js";

class NotificationService {
  // Generic push (keep for chat, wallet, etc.)
  static async sendPushNotification(userId, title, body, data = {}) {
    try {
      const user = await User.findById(userId);
      if (!user?.deviceToken) {
        logger.warn(`User ${userId} has no device token`);
        return false;
      }

      const payload = {
        token: user.deviceToken,
        notification: { title, body },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: data.type?.includes("CALL") ? "call_channel" : "default_channel",
          },
        },
      };

      await admin.messaging().send(payload);
      logger.info(`FCM sent to ${userId}`);
      return true;
    } catch (error) {
      logger.error("FCM error:", error);
      return false;
    }
  }

  // ──────────────────────────────
  // CRITICAL: sendCallEvent (Android-only – works when app killed)
  // ──────────────────────────────
  static async sendCallEvent({
    toUserId,
    event,
    callerId,
    receiverId,
    callRecordId,
    callerName = "Astrologer",
    callerAvatar = "",
    callType = "AUDIO",
  }) {
    try {
      const user = await User.findById(toUserId);
      if (!user?.deviceToken) {
        logger.warn(`No FCM token for user ${toUserId}`);
        return false;
      }

      const payload = {
        event: String(event),
        type: event === "incoming" ? "incoming" : event, // matches your frontend
        screen: "IncomingCall", // matches your logs
        callRecordId: String(callRecordId),
        callerId: String(callerId),
        receiverId: String(receiverId),
        callerName: String(callerName),
        callerAvatar: String(callerAvatar),
        callType: String(callType).toUpperCase(),

        // 100% safe fallback – used when app is killed
        params: JSON.stringify({
          callRecordId: String(callRecordId),
          callerId: String(callerId),
          receiverId: String(receiverId),
          callerName: String(callerName),
          callerAvatar: String(callerAvatar),
          callType: String(callType).toUpperCase(),
          event: String(event),
        }),
      };

      const message = {
        token: user.deviceToken,

        // DO NOT show visible notification for incoming call
        // (we show it via Notifee on frontend)
        notification: event !== "incoming" ? {
          title: this.title(event),
          body: this.body(event, callerName),
        } : undefined,

        data: payload,

        // THIS IS THE KEY: wakes app even in Doze/killed state
        android: {
          priority: "high",
          ttl: 60 * 1000, // 60 seconds
          collapseKey: `call_${callRecordId}`,
        },
      };

      await admin.messaging().send(message);
      logger.info(`Call event "${event}" sent → ${toUserId} | ${callRecordId}`);
      return true;
    } catch (error) {
      logger.error("sendCallEvent FCM failed:", error);
      return false;
    }
  }

  // Keep your old ones if you want
  static async sendIncomingCallNotification(receiverId, caller, callRecordId) {
    return this.sendCallEvent({
      toUserId: receiverId,
      event: "incoming",
      callerId: caller._id,
      receiverId,
      callRecordId,
      callerName: caller.fullName,
      callerAvatar: caller.profilePicture,
      callType: "AUDIO",
    });
  }

  static title(event) {
    const titles = {
      incoming: "Incoming Call",
      accepted: "Call Connected",
      rejected: "Call Rejected",
      missed: "Missed Call",
      cancelled: "Call Cancelled",
    };
    return titles[event] || "Call Update";
  }

  static body(event, name) {
    const bodies = {
      incoming: `${name} is calling you`,
      accepted: `${name} accepted your call`,
      rejected: `${name} rejected the call`,
      missed: `Missed call from ${name}`,
      cancelled: `${name} cancelled the call`,
    };
    return bodies[event] || "Call update";
  }
}

export default NotificationService;