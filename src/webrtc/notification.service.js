import admin from 'firebase-admin';
import { User } from '../models/user.js';
import logger from '../utils/logger.js';

async function sendNotification({
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

    const payload = {
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', contentAvailable: true } },
      },
      data: {
        screen,
        type,
        call_type: callType,
        title,
        body: message,
        time: Math.floor(Date.now() / 1000).toString(),
        params: JSON.stringify({
          user_id: userId,
          agent_id: receiverId,
          username: senderName,
          imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png',
          ...extraData,
        }),
      },
      token: user.deviceToken,
    };

    const response = await admin.messaging().send(payload);
    logger.info(`Push notification sent`, { userId, screen, type });
    return { success: true, response };
  } catch (error) {
    logger.error(`Error sending notification`, { userId, error });
    return { success: false, error };
  }
}

export default sendNotification;
