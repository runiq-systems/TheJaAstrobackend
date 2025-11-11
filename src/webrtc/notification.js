import admin from "../utils/firabse.js";
import logger from "../utils/logger.js";

export class CallNotificationService {
    static async sendCallNotification({
        targetUserId,
        title,
        message,
        type = "incoming", // 'incoming', 'accepted', 'rejected', 'missed', 'cancelled', 'ended'
        fromUserId,
        fromName,
        fromAvatar,
        fromEmail,
        screen = "IncomingCall",
        callType = "audio",
        callRecordId = null,
        duration = null
    }) {
        try {
            const user = await User.findById(targetUserId);
            if (!user?.deviceToken) {
                logger.warn(`⚠️ No device token for user: ${targetUserId}`);
                return false;
            }

            const timestamp = Math.floor(Date.now() / 1000).toString();
            
            // Configure notification based on type
            const notificationConfig = this.getNotificationConfig(type, title, message, fromName);
            
            const payload = {
                token: user.deviceToken,
                notification: notificationConfig.notification,
                data: {
                    type,
                    screen: notificationConfig.screen,
                    call_type: callType,
                    caller_id: fromUserId,
                    caller_name: fromName || "Unknown Caller",
                    caller_avatar: fromAvatar || "https://investogram.ukvalley.com/avatars/default.png",
                    caller_email: fromEmail || "N/A",
                    call_record_id: callRecordId || "",
                    duration: duration ? duration.toString() : "",
                    timestamp,
                    action: notificationConfig.action,
                    sound: "default",
                    vibration: "true",
                    priority: "high",
                    params: JSON.stringify({
                        user_id: fromUserId,
                        username: fromName,
                        email: fromEmail,
                        imageurl: fromAvatar,
                        navigate_to: notificationConfig.screen,
                        call_type: callType,
                        call_record_id: callRecordId,
                        call_status: type
                    }),
                },
                android: {
                    priority: "high",
                    notification: {
                        sound: "default",
                        channelId: notificationConfig.channelId,
                        visibility: "public",
                        icon: "ic_notification",
                        color: "#FF0000",
                        tag: `call_${type}_${callRecordId || timestamp}`,
                    },
                },
                apns: {
                    payload: {
                        aps: {
                            sound: "default",
                            badge: type === 'incoming' ? 1 : 0,
                            contentAvailable: true,
                            mutableContent: true,
                            category: notificationConfig.category,
                        },
                    },
                    headers: {
                        "apns-priority": "10", // Immediate delivery
                        "apns-push-type": "voip", // For VoIP notifications
                    },
                },
            };

            // For incoming calls, use data-only payload to handle in foreground
            if (type === "incoming") {
                delete payload.notification;
                payload.data.foreground = "true";
                payload.data.ringtone = "default";
            }

            const response = await admin.messaging().send(payload);
            logger.info(`✅ [FCM] ${type} notification sent → ${targetUserId} (${response})`);
            
            return true;
        } catch (error) {
            logger.error(`❌ Error sending ${type} notification:`, error);
            return false;
        }
    }

    static getNotificationConfig(type, customTitle, customMessage, fromName) {
        const configs = {
            incoming: {
                screen: "IncomingCall",
                action: "open_call_screen",
                channelId: "calls_high_priority",
                category: "INCOMING_CALL"
            },
            accepted: {
                notification: {
                    title: customTitle || "Call Accepted",
                    body: customMessage || `${fromName} accepted your call`
                },
                screen: "CallScreen",
                action: "update_call_status",
                channelId: "calls",
                category: "CALL_UPDATE"
            },
            rejected: {
                notification: {
                    title: customTitle || "Call Rejected",
                    body: customMessage || `${fromName} rejected your call`
                },
                screen: "CallHistory",
                action: "navigate_to_history",
                channelId: "calls",
                category: "CALL_UPDATE"
            },
            missed: {
                notification: {
                    title: customTitle || "Missed Call",
                    body: customMessage || `You missed a call from ${fromName}`
                },
                screen: "CallHistory",
                action: "navigate_to_history",
                channelId: "calls",
                category: "MISSED_CALL"
            },
            cancelled: {
                notification: {
                    title: customTitle || "Call Cancelled",
                    body: customMessage || `${fromName} cancelled the call`
                },
                screen: "CallList",
                action: "navigate_to_calls",
                channelId: "calls",
                category: "CALL_UPDATE"
            },
            ended: {
                notification: {
                    title: customTitle || "Call Ended",
                    body: customMessage || `Call with ${fromName} has ended`
                },
                screen: "CallHistory",
                action: "navigate_to_history",
                channelId: "calls",
                category: "CALL_UPDATE"
            }
        };

        return configs[type] || configs.incoming;
    }
}