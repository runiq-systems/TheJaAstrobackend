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
            channelId: data.type?.includes("CALL")
              ? "call_channel"
              : "default_channel",
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
    receiverId, // THIS IS CRITICAL - ensure this is passed
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

      // VALIDATE REQUIRED FIELDS
      if (!receiverId) {
        logger.error(
          `Missing receiverId for call event ${event} to user ${toUserId}`
        );
        receiverId = toUserId; // Fallback: current user is the receiver
      }

      const payload = {
        event: String(event),
        type: event === "incoming" ? "incoming" : event,
        screen: "Incomingcall", // Fixed: match your actual screen name
        callRecordId: String(callRecordId),
        callerId: String(callerId),
        receiverId: String(receiverId), // THIS MUST BE INCLUDED
        callerName: String(callerName),
        callerAvatar: String(callerAvatar),
        callType: String(callType).toUpperCase(),

        // Complete params for killed state
        params: JSON.stringify({
          callRecordId: String(callRecordId),
          callerId: String(callerId),
          receiverId: String(receiverId), // INCLUDED HERE TOO
          callerName: String(callerName),
          callerAvatar: String(callerAvatar),
          callType: String(callType).toUpperCase(),
          event: String(event),
        }),
      };

      const message = {
        token: user.deviceToken,
        data: payload,
        android: {
          priority: "high",
          ttl: 45 * 1000, // 45 seconds
          collapseKey: `call_${callRecordId}`,
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: 1,
              sound: "rington.caf",
            },
          },
        },
      };

      // Only add notification for non-incoming events
      if (event !== "incoming") {
        message.notification = {
          title: this.title(event),
          body: this.body(event, callerName),
        };
      }

      await admin.messaging().send(message);
      logger.info(
        `📞 Call "${event}" sent → ${toUserId} | receiver: ${receiverId}`
      );
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
