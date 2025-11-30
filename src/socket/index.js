// socketServer.js - Complete Fixed Version
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { ChatEventsEnum } from "../constants.js";
import { User } from "../models/user.js";
import { ChatSession } from "../models/chatapp/chatSession.js";
import { Chat } from "../models/chatapp/chat.js";
import { Message } from "../models/chatapp/message.js";
import { ApiError } from "../utils/ApiError.js";
import logger from "../utils/logger.js";

/* -------------------------------------------------------------------------- */
/*                          🔧  SOCKET EVENT MOUNTERS                         */
/* -------------------------------------------------------------------------- */

/**
 * @description Enhanced join chat with session validation
 * @param {Socket} socket
 */
const mountJoinChatEvent = (socket) => {
  socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, async (data) => {
    try {
      const { chatId, sessionId, userId, userRole } = data;

      if (!chatId) {
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Chat ID is required");
        return;
      }

      console.log(`✅ User ${socket.user._id} (${userRole}) joining chat: ${chatId}, session: ${sessionId}`);

      // Validate user has access to this chat
      const chat = await Chat.findById(chatId);
      if (!chat) {
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Chat not found");
        return;
      }

      // Check if user is a participant in this chat
      const isParticipant = chat.participants.some(
        participant => participant.userId.toString() === socket.user._id.toString()
      );

      if (!isParticipant) {
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Not authorized to join this chat");
        return;
      }

      // Join the chat room
      socket.join(chatId);

      // Also join user's personal room for notifications
      socket.join(socket.user._id.toString());

      console.log(`✅ User ${socket.user._id} successfully joined chat ${chatId}`);

      // Notify others in the chat that user joined
      socket.to(chatId).emit(ChatEventsEnum.USER_JOINED_EVENT, {
        chatId,
        userId: socket.user._id,
        userRole: socket.user.role,
        username: socket.user.username,
        timestamp: new Date()
      });

    } catch (error) {
      console.error("Error joining chat:", error);
      socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Failed to join chat");
    }
  });
};

/**
 * @description Enhanced typing events with session validation
 * @param {Socket} socket
 */
const mountTypingEvents = (socket) => {
  // Typing started
  socket.on(ChatEventsEnum.TYPING_EVENT, async (data) => {
    try {
      const { chatId } = data;

      if (!chatId) return;

      // Validate user can type in this chat (has active session)
      const canType = await validateChatAccess(socket.user._id, chatId);
      if (!canType) {
        console.log(`⚠️ User ${socket.user._id} cannot type in chat ${chatId} - no active session`);
        return;
      }

      console.log(`✍️ User ${socket.user._id} typing in chat ${chatId}`);

      socket.to(chatId).emit(ChatEventsEnum.TYPING_EVENT, {
        chatId,
        userId: socket.user._id,
        username: socket.user.username,
        typing: true,
        timestamp: new Date(),
      });

    } catch (error) {
      console.error("Error handling typing event:", error);
    }
  });

  // Typing stopped
  socket.on(ChatEventsEnum.STOP_TYPING_EVENT, async (data) => {
    try {
      const { chatId } = data;
      if (!chatId) return;

      console.log(`💤 User ${socket.user._id} stopped typing in chat ${chatId}`);

      socket.to(chatId).emit(ChatEventsEnum.STOP_TYPING_EVENT, {
        chatId,
        userId: socket.user._id,
        username: socket.user.username,
        typing: false,
        timestamp: new Date(),
      });

    } catch (error) {
      console.error("Error handling stop typing event:", error);
    }
  });
};

/**
 * @description Handle new messages with session validation
 * @param {Socket} socket
 */
// socketServer.js - Key Updates for Message Handling

/**
 * @description Handle new messages with enhanced validation
 */
const mountMessageEvents = (socket) => {
  socket.on(ChatEventsEnum.NEW_MESSAGE_EVENT, async (messageData) => {
    try {
      const { chatId, content, type = 'text' } = messageData;

      if (!chatId || !content) {
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Missing chatId or content");
        return;
      }

      console.log(`📨 New message from user ${socket.user._id} in chat ${chatId}:`, {
        content: content.substring(0, 50) + '...',
        type,
        userRole: socket.user.role
      });

      // Validate user can send messages in this chat
      const canSend = await validateMessageSending(socket.user._id, chatId, socket.user.role);
      if (!canSend.allowed) {
        console.log(`🚫 User ${socket.user._id} cannot send messages in chat ${chatId}:`, canSend.reason);
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, canSend.reason);
        return;
      }

      // Create message object for broadcasting
      const messageForBroadcast = {
        ...messageData,
        _id: messageData._id || new Date().getTime().toString(),
        sender: {
          _id: socket.user._id,
          username: socket.user.username,
          fullName: socket.user.fullName,
          avatar: socket.user.avatar,
          role: socket.user.role
        },
        chatId,
        createdAt: messageData.createdAt || new Date(),
        readBy: [socket.user._id]
      };

      // Broadcast message to all users in the chat room
      socket.to(chatId).emit(ChatEventsEnum.NEW_MESSAGE_EVENT, messageForBroadcast);

      // Also emit to sender for consistency
      socket.emit(ChatEventsEnum.NEW_MESSAGE_EVENT, messageForBroadcast);

      console.log(`✅ Message broadcasted to chat ${chatId} from user ${socket.user._id}`);

    } catch (error) {
      console.error("Error handling new message:", error);
      socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Failed to send message");
    }
  });
};

/**
 * @description Enhanced validation for message sending
 */
const validateMessageSending = async (userId, chatId, userRole) => {
  try {
    // Find active session for this chat
    const activeSession = await ChatSession.findOne({
      chatId,
      $or: [
        { status: 'ACTIVE' },
        { status: 'ACCEPTED', astrologerId: userId } // Astrologers can send in ACCEPTED sessions
      ]
    });

    if (!activeSession) {
      return {
        allowed: false,
        reason: "No active session found for this chat"
      };
    }

    // Check if user is participant in the session
    const isUserInSession = activeSession.userId.toString() === userId.toString();
    const isAstrologerInSession = activeSession.astrologerId.toString() === userId.toString();

    if (!isUserInSession && !isAstrologerInSession) {
      return {
        allowed: false,
        reason: "You are not a participant in this session"
      };
    }

    // Role-specific validations
    if (userRole === 'user') {
      // Users can only send messages when session is ACTIVE
      if (activeSession.status !== 'ACTIVE') {
        return {
          allowed: false,
          reason: "Session is not active. Please start the session to send messages."
        };
      }
    } else if (userRole === 'astrologer') {
      // Astrologers can send messages when session is ACCEPTED or ACTIVE
      if (!['ACCEPTED', 'ACTIVE'].includes(activeSession.status)) {
        return {
          allowed: false,
          reason: "Session is not active or accepted"
        };
      }
    }

    return { allowed: true, reason: "" };

  } catch (error) {
    console.error("Error validating message sending:", error);
    return {
      allowed: false,
      reason: "Error validating session"
    };
  }
};

/**
 * @description Handle message read status updates
 * @param {Socket} socket
 */
const mountMessageReadEvent = (socket) => {
  socket.on(ChatEventsEnum.MESSAGE_READ_EVENT, async (data) => {
    try {
      const { messageId, chatId } = data;

      if (!messageId || !chatId) return;

      console.log(`👀 User ${socket.user._id} read message ${messageId} in chat ${chatId}`);

      socket.to(chatId).emit(ChatEventsEnum.MESSAGE_READ_EVENT, {
        messageId,
        chatId,
        readBy: socket.user._id,
        readAt: new Date(),
      });

    } catch (error) {
      console.error("Error handling message read event:", error);
    }
  });
};

/**
 * @description Handle chat session events
 * @param {Socket} socket
 */
const mountChatSessionEvents = (socket) => {
  // Session started
  socket.on(ChatEventsEnum.SESSION_STARTED_EVENT, async (data) => {
    try {
      const { chatId, sessionId } = data;

      if (!chatId || !sessionId) return;

      console.log(`🟢 Session started: ${sessionId} in chat ${chatId}`);

      // Broadcast to all participants in the chat
      socket.to(chatId).emit(ChatEventsEnum.SESSION_STARTED_EVENT, {
        sessionId,
        chatId,
        startedAt: new Date(),
        startedBy: socket.user._id
      });

    } catch (error) {
      console.error("Error handling session started event:", error);
    }
  });

  // Session ended
  socket.on(ChatEventsEnum.SESSION_ENDED_EVENT, async (data) => {
    try {
      const { chatId, sessionId, totalCost, totalDuration } = data;

      if (!chatId || !sessionId) return;

      console.log(`🔴 Session ended: ${sessionId} in chat ${chatId}`);

      socket.to(chatId).emit(ChatEventsEnum.SESSION_ENDED_EVENT, {
        sessionId,
        chatId,
        totalCost,
        totalDuration,
        endedAt: new Date(),
        endedBy: socket.user._id
      });

    } catch (error) {
      console.error("Error handling session ended event:", error);
    }
  });

  // Chat request accepted
  socket.on(ChatEventsEnum.CHAT_ACCEPTED_EVENT, async (data) => {
    try {
      const { chatId, requestId, sessionId } = data;

      console.log(`✅ Chat request accepted: ${requestId} -> session: ${sessionId}`);

      socket.to(chatId).emit(ChatEventsEnum.CHAT_ACCEPTED_EVENT, {
        requestId,
        sessionId,
        chatId,
        acceptedBy: socket.user._id,
        acceptedAt: new Date()
      });

    } catch (error) {
      console.error("Error handling chat accepted event:", error);
    }
  });

  // Chat request rejected
  socket.on(ChatEventsEnum.CHAT_REJECTED_EVENT, async (data) => {
    try {
      const { chatId, requestId } = data;

      console.log(`❌ Chat request rejected: ${requestId}`);

      socket.to(chatId).emit(ChatEventsEnum.CHAT_REJECTED_EVENT, {
        requestId,
        chatId,
        rejectedBy: socket.user._id,
        rejectedAt: new Date(),
        reason: data.reason || "Astrologer unavailable"
      });

    } catch (error) {
      console.error("Error handling chat rejected event:", error);
    }
  });

  // Chat request cancelled
  socket.on(ChatEventsEnum.CHAT_CANCELLED_EVENT, async (data) => {
    try {
      const { chatId, requestId } = data;

      console.log(`🚫 Chat request cancelled: ${requestId}`);

      socket.to(chatId).emit(ChatEventsEnum.CHAT_CANCELLED_EVENT, {
        requestId,
        chatId,
        cancelledBy: socket.user._id,
        cancelledAt: new Date()
      });

    } catch (error) {
      console.error("Error handling chat cancelled event:", error);
    }
  });
};

/**
 * @description Handle billing updates during active sessions
 * @param {Socket} socket
 */
const mountBillingEvents = (socket) => {
  socket.on(ChatEventsEnum.BILLING_UPDATE_EVENT, async (data) => {
    try {
      const { chatId, sessionId, currentCost, billedDuration } = data;

      if (!chatId || !sessionId) return;

      console.log(`💰 Billing update for session ${sessionId}: ₹${currentCost}`);

      // Send billing update to user only (not astrologer)
      // Find user ID from session
      const session = await ChatSession.findOne({ sessionId });
      if (session && session.userId) {
        socket.to(session.userId.toString()).emit(ChatEventsEnum.BILLING_UPDATE_EVENT, {
          sessionId,
          chatId,
          currentCost,
          billedDuration,
          updatedAt: new Date()
        });
      }

    } catch (error) {
      console.error("Error handling billing update event:", error);
    }
  });
};

/* -------------------------------------------------------------------------- */
/*                          🛡️  VALIDATION HELPERS                           */
/* -------------------------------------------------------------------------- */

/**
 * @description Validate if user can send messages in a chat
 * @param {string} userId 
 * @param {string} chatId 
 * @param {string} userRole 
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
// const validateMessageSending = async (userId, chatId, userRole) => {
//   try {
//     // Find active session for this chat
//     const activeSession = await ChatSession.findOne({
//       chatId,
//       status: 'ACTIVE'
//     });

//     if (!activeSession) {
//       return {
//         allowed: false,
//         reason: "No active session found for this chat"
//       };
//     }

//     // Check if user is participant in the session
//     const isUserInSession = activeSession.userId.toString() === userId;
//     const isAstrologerInSession = activeSession.astrologerId.toString() === userId;

//     if (!isUserInSession && !isAstrologerInSession) {
//       return {
//         allowed: false,
//         reason: "You are not a participant in this session"
//       };
//     }

//     // Role-specific validations
//     if (userRole === 'user') {
//       // Users can only send messages when session is ACTIVE
//       if (activeSession.status !== 'ACTIVE') {
//         return {
//           allowed: false,
//           reason: "Session is not active. Please start the session to send messages."
//         };
//       }
//     } else if (userRole === 'astrologer') {
//       // Astrologers can send messages when session is ACCEPTED or ACTIVE
//       if (!['ACCEPTED', 'ACTIVE'].includes(activeSession.status)) {
//         return {
//           allowed: false,
//           reason: "Session is not active or accepted"
//         };
//       }
//     }

//     return { allowed: true, reason: "" };

//   } catch (error) {
//     console.error("Error validating message sending:", error);
//     return {
//       allowed: false,
//       reason: "Error validating session"
//     };
//   }
// };

/**
 * @description Validate if user has access to a chat
 * @param {string} userId 
 * @param {string} chatId 
 * @returns {Promise<boolean>}
 */
const validateChatAccess = async (userId, chatId) => {
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) return false;

    return chat.participants.some(
      participant => participant.userId.toString() === userId.toString()
    );
  } catch (error) {
    console.error("Error validating chat access:", error);
    return false;
  }
};

/* -------------------------------------------------------------------------- */
/*                          🚀  SOCKET SERVER CORE                            */
/* -------------------------------------------------------------------------- */

/**
 * @description Initialize Socket.IO server and handle connections
 * @param {Server} io
 */
export const initializeSocketIO = (io) => {
  io.on("connection", async (socket) => {
    try {
      console.log(`🔌 New socket connection attempt: ${socket.id}`);

      // Parse cookies from headers (works with withCredentials: true)
      const cookies = cookie.parse(socket.handshake.headers?.cookie || "");
      let token = cookies?.accessToken || socket.handshake.auth?.token;

      if (!token) {
        console.log("❌ No token provided for socket connection");
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Unauthorized: Token missing");
        socket.disconnect();
        return;
      }

      // Verify JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(decoded?.id).select("-password -refreshToken");

      if (!user) {
        console.log("❌ Invalid user for socket connection");
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Unauthorized: Invalid user");
        socket.disconnect();
        return;
      }

      // Attach user to socket
      socket.user = user;

      // Join user's personal room for direct messaging
      socket.join(user._id.toString());

      console.log(`🟢 User connected: ${user.username} (${user._id}) as ${user.role}`);

      // Notify client that connection is established
      socket.emit(ChatEventsEnum.CONNECTED_EVENT, {
        userId: user._id,
        userRole: user.role,
        username: user.username
      });

      /* -------------------------------- Mount events ------------------------------- */
      mountJoinChatEvent(socket);
      mountTypingEvents(socket);
      mountMessageEvents(socket); // ✅ CRITICAL: This was missing!
      mountMessageReadEvent(socket);
      mountChatSessionEvents(socket);
      mountBillingEvents(socket);
      // mountGroupChatEvents(socket); // Uncomment if needed

      console.log(`✅ All event handlers mounted for user ${user.username}`);

      /* ------------------------------- Disconnect event ----------------------------- */
      socket.on("disconnect", (reason) => {
        console.log(`🔴 User disconnected: ${socket.user?.username} (${socket.user?._id}) - Reason: ${reason}`);

        // Leave all rooms
        if (socket.user) {
          socket.leave(socket.user._id.toString());
        }
      });

      /* ------------------------------- Error handling ------------------------------ */
      socket.on("error", (error) => {
        console.error(`⚡ Socket error for user ${socket.user?.username}:`, error);
      });

    } catch (error) {
      console.error("❌ Socket connection error:", error.message);
      socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, error?.message || "Socket connection failed");
      socket.disconnect();
    }
  });

  // Add global error handling
  io.engine.on("connection_error", (err) => {
    console.error("🚨 Socket server connection error:", err);
  });
};

/* -------------------------------------------------------------------------- */
/*                        🎯  UTILITY EMIT FUNCTION                           */
/* -------------------------------------------------------------------------- */

/**
 * @description Emit a socket event to a specific room from a REST API
 * @param {import("express").Request} req - Express request (with io instance)
 * @param {string} roomId - Room ID or user ID
 * @param {string} event - Event name from ChatEventsEnum
 * @param {any} payload - Event data
 */
export const emitSocketEvent = (req, roomId, event, payload) => {
  try {
    const io = req.app.get("io");
    if (!io) {
      console.error("❌ Socket.IO instance not found in app");
      return;
    }

    console.log(`📤 Emitting event: ${event} to room: ${roomId}`, {
      payload: typeof payload === 'object' ? { ...payload, content: payload.content ? `${payload.content.substring(0, 30)}...` : 'N/A' } : payload
    });

    io.in(roomId).emit(event, payload);

    console.log(`✅ Event ${event} emitted successfully to room ${roomId}`);

  } catch (error) {
    console.error("❌ Failed to emit socket event:", error);
  }
};

/**
 * @description Emit event to multiple rooms
 * @param {import("express").Request} req 
 * @param {string[]} roomIds 
 * @param {string} event 
 * @param {any} payload 
 */
export const emitSocketEventToMultiple = (req, roomIds, event, payload) => {
  try {
    const io = req.app.get("io");
    if (!io) {
      console.error("❌ Socket.IO instance not found in app");
      return;
    }

    roomIds.forEach(roomId => {
      io.in(roomId).emit(event, payload);
    });

    console.log(`✅ Event ${event} emitted to ${roomIds.length} rooms`);

  } catch (error) {
    console.error("❌ Failed to emit socket event to multiple rooms:", error);
  }
};

/**
 * @description Emit event to all except specified socket
 * @param {import("express").Request} req 
 * @param {string} excludeSocketId 
 * @param {string} event 
 * @param {any} payload 
 */
export const emitSocketEventToAllExcept = (req, excludeSocketId, event, payload) => {
  try {
    const io = req.app.get("io");
    if (!io) {
      console.error("❌ Socket.IO instance not found in app");
      return;
    }

    socket.broadcast.emit(event, payload);
    console.log(`✅ Event ${event} emitted to all except ${excludeSocketId}`);

  } catch (error) {
    console.error("❌ Failed to emit socket event to all except:", error);
  }
};