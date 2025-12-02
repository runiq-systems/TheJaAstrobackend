// ✅ ChatEventsEnum.js

export const ChatEventsEnum = Object.freeze({
  // 🔌 Connection & System
  CONNECTED_EVENT: "connected", // Socket connected
  DISCONNECT_EVENT: "disconnect", // Socket disconnected
  RECONNECT_EVENT: "reconnect", // Socket reconnected
  SOCKET_ERROR_EVENT: "socketError", // Socket error occurred
  CONNECTION_FAILED_EVENT: "connectionFailed", // Connection failure
  SOCKET_ERROR_EVENT: "socketError",

  // 👤 User Presence
  USER_ONLINE_EVENT: "userOnline", // User went online
  USER_OFFLINE_EVENT: "userOffline", // User went offline
  LAST_SEEN_EVENT: "lastSeen", // User's last seen updated
  STATUS_UPDATE_EVENT: "statusUpdate", // User status changed (busy, away, etc.)

  // 💬 Chat Room Management
  JOIN_CHAT_EVENT: "joinChat", // Join chat room
  LEAVE_CHAT_EVENT: "leaveChat", // Leave chat room
  CREATE_CHAT_EVENT: "createChat", // New chat created
  DELETE_CHAT_EVENT: "deleteChat", // Chat deleted
  CHAT_UPDATED_EVENT: "chatUpdated", // Chat metadata updated (name, image, etc.)
  USER_JOINED_EVENT: "userJoined",

  // 🧑‍🤝‍🧑 Group Chat Management
  GROUP_CREATED_EVENT: "groupCreated", // New group created
  GROUP_MEMBER_ADDED_EVENT: "groupMemberAdded", // New member added to group
  GROUP_MEMBER_REMOVED_EVENT: "groupMemberRemoved", // Member removed from group
  GROUP_INFO_UPDATED_EVENT: "groupInfoUpdated", // Group name/photo changed
  GROUP_LEFT_EVENT: "groupLeft", // User left the group

  // 📩 Messaging Events
  NEW_MESSAGE_EVENT: "newMessage", // Message sent
  MESSAGE_RECEIVED_EVENT: "messageReceived", // Message received by another user
  MESSAGE_DELIVERED_EVENT: "messageDelivered", // Message delivered (sent → delivered)
  MESSAGE_READ_EVENT: "messageRead", // Message read by user
  MESSAGE_EDIT_EVENT: "messageEdited", // Message edited
  MESSAGE_DELETE_EVENT: "messageDeleted", // Message deleted
  MESSAGE_REACTION_EVENT: "messageReaction", // Reaction added to message
  BULK_MESSAGE_EVENT: "bulkMessages", // When multiple messages are sent/loaded at once

  // 🖼️ Media Sharing
  FILE_UPLOAD_EVENT: "fileUpload", // File upload initiated
  FILE_UPLOAD_SUCCESS_EVENT: "fileUploadSuccess", // File uploaded successfully
  FILE_UPLOAD_ERROR_EVENT: "fileUploadError", // File upload failed
  IMAGE_MESSAGE_EVENT: "imageMessage", // Image sent in chat
  VIDEO_MESSAGE_EVENT: "videoMessage", // Video sent in chat
  AUDIO_MESSAGE_EVENT: "audioMessage", // Audio message sent
  DOCUMENT_MESSAGE_EVENT: "documentMessage", // Document sent

  // ✍️ Typing & Interaction
  TYPING_EVENT: "typing", // User is typing
  STOP_TYPING_EVENT: "stopTyping", // User stopped typing
  RECORDING_AUDIO_EVENT: "recordingAudio", // User is recording a voice note
  STOP_RECORDING_AUDIO_EVENT: "stopRecordingAudio", // User stopped recording
  MESSAGE_REPLIED_EVENT: "messageReplied", // When user replies to a message

  // 📞 Voice & Video Calls
  CALL_INITIATED_EVENT: "callInitiated", // User initiated a call
  CALL_ACCEPTED_EVENT: "callAccepted", // Call accepted
  CALL_REJECTED_EVENT: "callRejected", // Call rejected
  CALL_ENDED_EVENT: "callEnded", // Call ended
  CALL_MISSED_EVENT: "callMissed", // Missed call
  CALL_RINGING_EVENT: "callRinging", // Ringing event
  CALL_ERROR_EVENT: "callError", // Call error occurred

  // 🔔 Notifications
  NOTIFICATION_EVENT: "notification", // Generic notification
  NEW_CHAT_NOTIFICATION_EVENT: "newChatNotification", // New chat notification
  MESSAGE_NOTIFICATION_EVENT: "messageNotification", // Message notification
  CALL_NOTIFICATION_EVENT: "callNotification", // Call notification

  // 🧮 Admin & Moderation
  USER_BANNED_EVENT: "userBanned", // User banned from chat
  USER_UNBANNED_EVENT: "userUnbanned", // User unbanned
  ADMIN_PROMOTED_EVENT: "adminPromoted", // User promoted to admin
  ADMIN_REMOVED_EVENT: "adminRemoved", // Admin rights removed
  CHAT_ARCHIVED_EVENT: "chatArchived", // Chat archived
  CHAT_UNARCHIVED_EVENT: "chatUnarchived", // Chat unarchived

  // Chat Session Events
  CHAT_REQUEST_EVENT: "chatRequest",
  CHAT_ACCEPTED_EVENT: "chatAccepted",
  CHAT_REJECTED_EVENT: "chatRejected",
  CHAT_CANCELLED_EVENT: "chatCancelled",
  SESSION_STARTED_EVENT: "sessionStarted",
  SESSION_PAUSED_EVENT: "sessionPaused",
  SESSION_RESUMED_EVENT: "sessionResumed",
  SESSION_ENDED_EVENT: "sessionEnded",
  BILLING_UPDATE_EVENT: "billingUpdate",
  SESSION_EXPIRED_EVENT: "sessionExpired",
  MISSED_CHAT_EVENT: "missedChat",
  RESERVATION_ENDING_SOON: "RESERVATION_ENDING_SOON",
  INSUFFICIENT_BALANCE_WARNING: "INSUFFICIENT_BALANCE_WARNING",


  SESSION_STARTED_EVENT: "SESSION_STARTED_EVENT",
  SESSION_ENDED_EVENT: "SESSION_ENDED_EVENT",
  BILLING_UPDATE_EVENT: "BILLING_UPDATE_EVENT",

  // NEW CRITICAL EVENTS
  RESERVATION_ENDING_SOON: "RESERVATION_ENDING_SOON",

  // 🧠 System Logs or AI Responses
  SYSTEM_MESSAGE_EVENT: "systemMessage", // System or bot message
  AI_RESPONSE_EVENT: "aiResponse", // AI-generated reply event
  LOG_EVENT: "logEvent", // Log/debug event

  // 💢 Error & Misc
  INVALID_EVENT: "invalidEvent", // Invalid socket event
  UNKNOWN_EVENT: "unknownEvent", // Unknown event type
  SERVER_RESTART_EVENT: "serverRestart", // Server restarted

  NEW_GROUP_CHAT_EVENT: "newGroupChat",
  UPDATE_GROUP_EVENT: "updateGroup",
});

// ✅ Export as array (optional, useful for validation)
export const AvailableChatEvents = Object.values(ChatEventsEnum);
