import admin from "firebase-admin";
import logger from "../utils/logger.js";
import { User } from "../models/user.js";

class NotificationService {
  static async sendPushNotification(userId, title, body, data = {}) {
    try {
      const user = await User.findById(userId);
      if (!user?.deviceToken) {
        logger.warn(`User ${userId} has no device token`);
        return false;
      }

      const payload = {
        token: user.deviceToken,
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: data.type === "INCOMING_CALL" ? "calls" : "messages",
          },
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              contentAvailable: 1,
            },
          },
        },
        data: {
          title,
          body,
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ),
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

  // INCOMING CALL
  static async sendIncomingCallNotification(receiverId, caller, callRecordId) {
    return this.sendPushNotification(
      receiverId,
      "Incoming Call",
      `${caller.fullName} is calling you`,
      {
        type: "INCOMING_CALL",
        screen: "Incomingcall",
        callerId: caller._id,
        callerName: caller.fullName,
        callerImage: caller.profilePicture,
        callRecordId,
      }
    );
  }

  // CHAT MESSAGE
  static async sendChatMessageNotification(receiverId, chat, sender) {
    return this.sendPushNotification(
      receiverId,
      sender.fullName,
      chat.lastMessage,
      {
        type: "CHAT_MESSAGE",
        screen: "AstrologerChat",
        chatId: chat._id,
        senderId: sender._id,
        senderName: sender.fullName,
        senderImage: sender.profilePicture,
      }
    );
  }

  // MISSED CALL
  static async sendMissedCall(receiverId, caller, callRecordId) {
    return this.sendPushNotification(
      receiverId,
      "Missed Call",
      `You missed a call from ${caller.fullName}`,
      {
        type: "MISSED_CALL",
        screen: "CallHistory",
        callRecordId,
      }
    );
  }

   static async sendCallEvent({
    toUserId,
    event,        // incoming | accepted | rejected | missed | cancelled
    callerId,
    receiverId,
    callRecordId,
    callerName,
    callerAvatar,
    callType,
  }) {
    const user = await User.findById(toUserId);
    if (!user?.deviceToken) return;

    const payload = {
      token: user.deviceToken,
      notification: event !== "incoming" ? {
        title: this.title(event),
        body: this.body(event, callerName),
      } : undefined,

      data: {
        type: event,
        screen: this.screen(event),
        callType,
        callerId: String(callerId),
        receiverId: String(receiverId),
        callRecordId: String(callRecordId),
        callerName,
        callerAvatar,
        params: JSON.stringify({
          callerId,
          receiverId,
          callRecordId,
          callerName,
          callerAvatar,
          callType,
        })
      },

      android: { priority: "high" },
      apns: { payload: { aps: { contentAvailable: true } } }
    };

    return admin.messaging().send(payload);
  }

  static title(event) {
    return {
      incoming: "Incoming Call",
      accepted: "Call Accepted",
      rejected: "Call Rejected",
      missed: "Missed Call",
      cancelled: "Call Cancelled",
    }[event];
  }

  static body(event, name) {
    return {
      incoming: `${name} is calling you`,
      accepted: `${name} accepted your call`,
      rejected: `${name} rejected your call`,
      missed: `You missed a call from ${name}`,
      cancelled: `${name} cancelled the call`,
    }[event];
  }

  static screen(event) {
    return {
      incoming: "IncomingCall",
      accepted: "CallScreen",
      rejected: "CallHistory",
      missed: "CallHistory",
      cancelled: "CallHistory",
    }[event];
  }
}

export default NotificationService;
