import { Expo } from 'expo-server-sdk';
import { User } from '../models/user';
import logger from '../utils/logger';
// Initialize Expo SDK
const expo = new Expo();

export class NotificationService {
  static async sendPushNotification(userId, title, body, data = {}) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.deviceToken) {
        logger.warn(`No device token found for user ${userId}`);
        return false;
      }

      // Check if token is valid
      if (!Expo.isExpoPushToken(user.deviceToken)) {
        logger.warn(`Invalid Expo push token for user ${userId}`);
        return false;
      }

      const message = {
        to: user.deviceToken,
        sound: 'default',
        title,
        body,
        data: {
          ...data,
          timestamp: Date.now(),
        },
        priority: 'high',
        channelId: 'calls',
      };

      const receipt = await expo.sendPushNotificationsAsync([message]);
      logger.info(`Push notification sent to user ${userId}`, { receipt });

      return true;
    } catch (error) {
      logger.error(`Error sending push notification to user ${userId}:`, error);
      return false;
    }
  }

  static async sendIncomingCallNotification(receiverId, callerData, callRecordId) {
    try {
      const user = await User.findById(receiverId);
      if (!user) return false;

      const title = 'Incoming Call';
      const body = `${callerData.name || callerData.username} is calling you`;
      
      const data = {
        type: 'INCOMING_CALL',
        callRecordId: callRecordId.toString(),
        callerId: callerData._id.toString(),
        callerName: callerData.name || callerData.username,
        callerPicture: callerData.profilePicture,
        timestamp: Date.now(),
      };

      return await this.sendPushNotification(receiverId, title, body, data);
    } catch (error) {
      logger.error(`Error sending incoming call notification:`, error);
      return false;
    }
  }

  static async sendCallMissedNotification(receiverId, callerData, callRecordId) {
    try {
      const title = 'Missed Call';
      const body = `You missed a call from ${callerData.name || callerData.username}`;
      
      const data = {
        type: 'MISSED_CALL',
        callRecordId: callRecordId.toString(),
        callerId: callerData._id.toString(),
        callerName: callerData.name || callerData.username,
        timestamp: Date.now(),
      };

      return await this.sendPushNotification(receiverId, title, body, data);
    } catch (error) {
      logger.error(`Error sending missed call notification:`, error);
      return false;
    }
  }

  static async sendCallAcceptedNotification(callerId, receiverData, callRecordId) {
    try {
      const title = 'Call Connected';
      const body = `Call connected with ${receiverData.name || receiverData.username}`;
      
      const data = {
        type: 'CALL_ACCEPTED',
        callRecordId: callRecordId.toString(),
        receiverId: receiverData._id.toString(),
        timestamp: Date.now(),
      };

      return await this.sendPushNotification(callerId, title, body, data);
    } catch (error) {
      logger.error(`Error sending call accepted notification:`, error);
      return false;
    }
  }

  static async sendCallEndedNotification(userId, otherUserData, callRecordId, duration) {
    try {
      const title = 'Call Ended';
      const body = `Call with ${otherUserData.name || otherUserData.username} ended (${this.formatDuration(duration)})`;
      
      const data = {
        type: 'CALL_ENDED',
        callRecordId: callRecordId.toString(),
        duration,
        timestamp: Date.now(),
      };

      return await this.sendPushNotification(userId, title, body, data);
    } catch (error) {
      logger.error(`Error sending call ended notification:`, error);
      return false;
    }
  }

  static async sendMultipleNotifications(userIds, title, body, data = {}) {
    try {
      const messages = [];
      
      for (const userId of userIds) {
        const user = await User.findById(userId);
        if (user && user.deviceToken && Expo.isExpoPushToken(user.deviceToken)) {
          messages.push({
            to: user.deviceToken,
            sound: 'default',
            title,
            body,
            data: { ...data, userId: userId.toString() },
          });
        }
      }

      if (messages.length > 0) {
        const receipts = await expo.sendPushNotificationsAsync(messages);
        logger.info(`Sent ${messages.length} push notifications`);
        return receipts;
      }
      
      return [];
    } catch (error) {
      logger.error('Error sending multiple notifications:', error);
      return [];
    }
  }

  static formatDuration(seconds) {
    if (!seconds) return '0s';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  // Batch notification sending for better performance
  static async sendBatchNotifications(notifications) {
    try {
      const validNotifications = notifications.filter(notification => 
        notification.token && Expo.isExpoPushToken(notification.token)
      );

      const chunks = expo.chunkPushNotifications(validNotifications);
      const tickets = [];

      for (const chunk of chunks) {
        try {
          const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...chunkTickets);
        } catch (error) {
          logger.error('Error sending notification chunk:', error);
        }
      }

      return tickets;
    } catch (error) {
      logger.error('Error in batch notification sending:', error);
      return [];
    }
  }
}

export default NotificationService;