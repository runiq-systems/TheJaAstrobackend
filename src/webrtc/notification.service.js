import admin from 'firebase-admin';
import { Expo } from 'expo-server-sdk';
import { User } from '../models/user.js';
import logger from '../utils/logger.js';

// Initialize Expo SDK
const expo = new Expo();

class NotificationService {
  async sendNotification({
    userId,
    title,
    message,
    screen = 'IncomingCall',
    type = 'info',
    receiverId = '',
    senderName = '',
    senderAvatar = '',
    callType = 'audio',
    extraData = {},
  }) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.deviceToken) {
        logger.warn(`User ${userId} has no device token.`);
        return { success: false, error: 'No device token' };
      }

      // Check if device token is valid
      if (!Expo.isExpoPushToken(user.deviceToken)) {
        logger.warn(`Invalid Expo push token for user ${userId}`);
        return { success: false, error: 'Invalid device token' };
      }

      const payload = {
        to: user.deviceToken,
        sound: 'default',
        title,
        body: message,
        data: {
          screen,
          type,
          callType,
          receiverId,
          senderName,
          senderAvatar,
          ...extraData,
          timestamp: Date.now().toString(),
        },
        priority: 'high',
        channelId: 'calls',
      };

      const receipt = await expo.sendPushNotificationsAsync([payload]);
      logger.info(`Push notification sent to user ${userId}`, { receipt });

      return { success: true, receipt };
    } catch (error) {
      logger.error(`Error sending push notification to user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendIncomingCallNotification(receiverId, callerData, callRecordId) {
    try {
      const user = await User.findById(receiverId);
      if (!user) return { success: false, error: 'User not found' };

      const title = 'Incoming Call';
      const body = `${callerData.name || callerData.username} is calling you`;
      
      const data = {
        type: 'INCOMING_CALL',
        callRecordId: callRecordId.toString(),
        callerId: callerData._id.toString(),
        callerName: callerData.name || callerData.username,
        callerPicture: callerData.profilePicture || '',
        timestamp: Date.now().toString(),
      };

      return await this.sendNotification({
        userId: receiverId,
        title,
        message: body,
        screen: 'IncomingCall',
        type: 'incoming_call',
        extraData: data,
      });
    } catch (error) {
      logger.error(`Error sending incoming call notification:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendCallMissedNotification(receiverId, callerData, callRecordId) {
    try {
      const title = 'Missed Call';
      const body = `You missed a call from ${callerData.name || callerData.username}`;
      
      const data = {
        type: 'MISSED_CALL',
        callRecordId: callRecordId.toString(),
        callerId: callerData._id.toString(),
        callerName: callerData.name || callerData.username,
        timestamp: Date.now().toString(),
      };

      return await this.sendNotification({
        userId: receiverId,
        title,
        message: body,
        screen: 'CallHistory',
        type: 'missed_call',
        extraData: data,
      });
    } catch (error) {
      logger.error(`Error sending missed call notification:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendCallAcceptedNotification(callerId, receiverData, callRecordId) {
    try {
      const title = 'Call Connected';
      const body = `Call connected with ${receiverData.name || receiverData.username}`;
      
      const data = {
        type: 'CALL_ACCEPTED',
        callRecordId: callRecordId.toString(),
        receiverId: receiverData._id.toString(),
        timestamp: Date.now().toString(),
      };

      return await this.sendNotification({
        userId: callerId,
        title,
        message: body,
        screen: 'CallScreen',
        type: 'call_accepted',
        extraData: data,
      });
    } catch (error) {
      logger.error(`Error sending call accepted notification:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendCallEndedNotification(userId, otherUserData, callRecordId, duration) {
    try {
      const title = 'Call Ended';
      const body = `Call with ${otherUserData.name || otherUserData.username} ended (${this.formatDuration(duration)})`;
      
      const data = {
        type: 'CALL_ENDED',
        callRecordId: callRecordId.toString(),
        duration: duration.toString(),
        timestamp: Date.now().toString(),
      };

      return await this.sendNotification({
        userId,
        title,
        message: body,
        screen: 'CallHistory',
        type: 'call_ended',
        extraData: data,
      });
    } catch (error) {
      logger.error(`Error sending call ended notification:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendMultipleNotifications(userIds, title, body, data = {}) {
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
        return { success: true, receipts };
      }
      
      return { success: false, error: 'No valid tokens found' };
    } catch (error) {
      logger.error('Error sending multiple notifications:', error);
      return { success: false, error: error.message };
    }
  }

  formatDuration(seconds) {
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
  async sendBatchNotifications(notifications) {
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

      return { success: true, tickets };
    } catch (error) {
      logger.error('Error in batch notification sending:', error);
      return { success: false, error: error.message, tickets: [] };
    }
  }

  // New method to handle notification receipts and errors
  async checkNotificationReceipts(receiptIds) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(receiptIds);
      
      // The receipts specify whether Apple or Google successfully received the
      // notification and information about an error, if one occurred.
      for (let receiptId in receipts) {
        const { status, message, details } = receipts[receiptId];
        
        if (status === 'ok') {
          continue;
        } else if (status === 'error') {
          logger.error(`There was an error sending a notification: ${message}`);
          if (details && details.error) {
            // The error codes are listed in the Expo documentation:
            // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
            logger.error(`The error code is ${details.error}`);
          }
        }
      }
      
      return receipts;
    } catch (error) {
      logger.error('Error checking notification receipts:', error);
      throw error;
    }
  }
}

export default NotificationService;