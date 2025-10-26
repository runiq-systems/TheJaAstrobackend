// socketServer.js
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { ChatEventsEnum } from "../constants.js";
import { User } from "../models/user.js";
import { ApiError } from "../utils/ApiError.js";
import logger from "../utils/logger.js";
/* -------------------------------------------------------------------------- */
/*                          🔧  SOCKET EVENT MOUNTERS                         */
/* -------------------------------------------------------------------------- */

/**
 * @description Handle user joining a specific chat room
 * @param {Socket} socket
 */
const mountJoinChatEvent = (socket) => {
  socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, (chatId) => {
    console.log(`✅ User joined chat: ${chatId}`);
    socket.join(chatId);
  });
};

/**
 * @description Handle typing indicator in chat
 * @param {Socket} socket
 */
const mountTypingEvents = (socket) => {
  // Typing started
  socket.on(ChatEventsEnum.TYPING_EVENT, (chatId) => {
    socket.to(chatId).emit(ChatEventsEnum.TYPING_EVENT, {
      chatId,
      userId: socket.user._id,
      username: socket.user.username,
      typing: true,
      timestamp: new Date(),
    });
  });

  // Typing stopped
  socket.on(ChatEventsEnum.STOP_TYPING_EVENT, (chatId) => {
    socket.to(chatId).emit(ChatEventsEnum.STOP_TYPING_EVENT, {
      chatId,
      userId: socket.user._id,
      username: socket.user.username,
      typing: false,
      timestamp: new Date(),
    });
  });
};

/**
 * @description Handle message read status updates
 * @param {Socket} socket
 */
const mountMessageReadEvent = (socket) => {
  socket.on(ChatEventsEnum.MESSAGE_READ_EVENT, ({ messageId, chatId }) => {
    socket.to(chatId).emit(ChatEventsEnum.MESSAGE_READ_EVENT, {
      messageId,
      chatId,
      readBy: socket.user._id,
      readAt: new Date(),
    });
  });
};

/**
 * @description Handle all group-related chat events (create, update, delete, etc.)
 * @param {Socket} socket
 */
const mountGroupChatEvents = (socket) => {
  // Join Request
  socket.on(ChatEventsEnum.JOIN_REQUEST_EVENT, (data) => {
    data.chat.admins.forEach((adminId) => {
      socket.to(adminId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_EVENT, data);
    });
  });

  // Join Request Approved
  socket.on(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, (data) => {
    socket.to(data.userId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, data);
    data.chat.admins.forEach((adminId) => {
      socket.to(adminId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, data);
    });
  });

  // Join Request Rejected
  socket.on(ChatEventsEnum.JOIN_REQUEST_REJECTED_EVENT, (data) => {
    socket.to(data.userId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_REJECTED_EVENT, data);
  });

  // New Group Chat Created
  socket.on(ChatEventsEnum.NEW_GROUP_CHAT_EVENT, (groupChat) => {
    groupChat.participants.forEach((participantId) => {
      if (participantId.toString() !== socket.user._id.toString()) {
        socket.to(participantId.toString()).emit(ChatEventsEnum.NEW_GROUP_CHAT_EVENT, groupChat);
      }
    });
  });

  // Group Chat Updated
  socket.on(ChatEventsEnum.UPDATE_GROUP_EVENT, (groupChat) => {
    groupChat.participants.forEach((participantId) => {
      socket.to(participantId.toString()).emit(ChatEventsEnum.UPDATE_GROUP_EVENT, groupChat);
    });
  });

  // User Removed
  socket.on(ChatEventsEnum.REMOVED_FROM_GROUP_EVENT, (data) => {
    socket.to(data.userId.toString()).emit(ChatEventsEnum.REMOVED_FROM_GROUP_EVENT, data);
  });

  // User Left Group
  socket.on(ChatEventsEnum.LEFT_GROUP_EVENT, (data) => {
    socket.to(data.userId.toString()).emit(ChatEventsEnum.LEFT_GROUP_EVENT, data);
  });

  // Group Deleted
  socket.on(ChatEventsEnum.GROUP_DELETED_EVENT, (data) => {
    data.participants.forEach((participantId) => {
      socket.to(participantId.toString()).emit(ChatEventsEnum.GROUP_DELETED_EVENT, data);
    });
  });

  // Group Message Received
  socket.on(ChatEventsEnum.GROUP_MESSAGE_RECEIVED_EVENT, (data) => {
    socket.to(data.chatId).emit(ChatEventsEnum.GROUP_MESSAGE_RECEIVED_EVENT, data);
  });
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
      // Parse cookies from headers (works with withCredentials: true)
      const cookies = cookie.parse(socket.handshake.headers?.cookie || "");
      let token = cookies?.accessToken || socket.handshake.auth?.token;

      if (!token) throw new ApiError(401, "Unauthorized: Token missing");

      // Verify JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(decoded?.id).select("-password -refreshToken");
      // console.log("decoded", decoded)
      // console.log("Decoded user :", user);


      if (!user) throw new ApiError(401, "Unauthorized: Invalid user");

      // Attach user to socket
      socket.user = user;
      socket.join(user._id.toString());
      // console.log(`🟢 User connected:  (${user._id})`);

      // Notify client that connection is established
      socket.emit(ChatEventsEnum.CONNECTED_EVENT, { userId: user._id });

      /* -------------------------------- Mount events ------------------------------- */
      mountJoinChatEvent(socket);
      mountTypingEvents(socket);
      mountMessageReadEvent(socket);
      mountGroupChatEvents(socket);

      // logger.info(`Socket connected: (${socket.user})`);
      /* ------------------------------- Disconnect event ----------------------------- */
      socket.on(ChatEventsEnum.DISCONNECT_EVENT, () => {
        console.log(`🔴 User disconnected: ${socket.user?.username} (${socket.user?._id})`);
        socket.leave(socket.user._id.toString());
      });

    } catch (error) {
      console.error("❌ Socket connection error:", error.message);
      socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, error?.message || "Socket connection failed");
    }
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
    io.in(roomId).emit(event, payload);
    console.log(`📤 Event emitted: ${payload} -> Room: ${event}`);
  } catch (error) {
    console.error("❌ Failed to emit socket event:", error);
  }
};
