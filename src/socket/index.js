// socketServer.js
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { ChatEventsEnum } from "../constants.js";
import { User } from "../models/user.js";
import logger from "../utils/logger.js";

// Global IO instance
let ioInstance = null;

export const getIO = () => {
  if (!ioInstance) throw new Error("Socket.IO not initialized!");
  return ioInstance;
};

/* -------------------------------------------------------------------------- */
/*                          SOCKET EVENT HANDLERS                             */
/* -------------------------------------------------------------------------- */

const mountJoinChatEvent = (socket) => {
  socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, (data) => {
    const chatId = typeof data === "string" ? data : data?.chatId;
    if (!chatId) return console.warn("Invalid JOIN_CHAT_EVENT:", data);

    socket.join(String(chatId));
    console.log(`User ${socket.user._id} joined chat room: ${chatId}`);
  });
};

const mountTypingEvents = (socket) => {
  socket.on(ChatEventsEnum.TYPING_EVENT, (chatId) => {
    socket.to(chatId).emit(ChatEventsEnum.TYPING_EVENT, {
      chatId,
      userId: socket.user._id,
      username: socket.user.fullName || socket.user.username,
      typing: true,
    });
  });

  socket.on(ChatEventsEnum.STOP_TYPING_EVENT, (chatId) => {
    socket.to(chatId).emit(ChatEventsEnum.STOP_TYPING_EVENT, {
      chatId,
      userId: socket.user._id,
      username: socket.user.fullName || socket.user.username,
      typing: false,
    });
  });
};

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

const mountGroupChatEvents = (socket) => {
  // Keep all your existing group events here (unchanged)
  // ... your code
};

/* -------------------------------------------------------------------------- */
/*                          INITIALIZE SOCKET SERVER                          */
/* -------------------------------------------------------------------------- */

export const initializeSocketIO = (server) => {
  ioInstance = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Make io globally accessible
  global.io = ioInstance;
  server.io = ioInstance; // also attach to http server

  ioInstance.on("connection", async (socket) => {
    try {
      // Extract token
      const cookies = cookie.parse(socket.handshake.headers?.cookie || "");
      const token = cookies?.accessToken || socket.handshake.auth?.token;

      if (!token) {
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Unauthorized: No token");
        return socket.disconnect();
      }

      // Verify JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(decoded.id || decoded._id)
        .select("-password -refreshToken")
        .lean();

      if (!user) {
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, "Invalid token");
        return socket.disconnect();
      }

      // Attach user to socket
      socket.user = user;
      socket.join(user._id.toString());

      console.log(`User connected: ${user.fullName} (${user._id}) | Socket: ${socket.id}`);

      // Confirm connection
      socket.emit(ChatEventsEnum.CONNECTED_EVENT, {
        userId: user._id,
        message: "Connected to server",
      });

      // Mount all events
      mountJoinChatEvent(socket);
      mountTypingEvents(socket);
      mountMessageReadEvent(socket);
      mountGroupChatEvents(socket);

      // Disconnect handler
      socket.on("disconnect", (reason) => {
        console.log(`User disconnected: ${user.fullName} (${user._id}) | Reason: ${reason}`);
      });

    } catch (error) {
      console.error("Socket connection error:", error.message);
      socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
        message: "Authentication failed",
        error: error.message,
      });
      socket.disconnect();
    }
  });

  console.log("Socket.IO Server Initialized Successfully");
  return ioInstance;
};

/* -------------------------------------------------------------------------- */
/*                          EMIT HELPERS (SAFE & CLEAN)                       */
/* -------------------------------------------------------------------------- */

// Use in controllers (has req)
export const emitSocketEvent = (req, roomId, event, payload) => {
  try {
    const io = req?.app?.get("io") || global.io;
    if (!io) return console.warn("Socket.IO not available (req)");

    io.to(String(roomId)).emit(event, payload);
    console.log(`Emitted → ${event} → Room: ${roomId}`);
  } catch (err) {
    console.error("emitSocketEvent failed:", err.message);
  }
};

// Use in timers, services, background jobs
export const emitSocketEventGlobal = (roomId, event, payload) => {
  try {
    if (!global.io) {
      console.warn("global.io not initialized yet");
      return;
    }
    global.io.to(String(roomId)).emit(event, payload);
    console.log(`[GLOBAL EMIT] → ${event} → Room: ${roomId}`);
  } catch (err) {
    console.error("emitSocketEventGlobal failed:", err.message);
  }
};

/* -------------------------------------------------------------------------- */
/*                          AUTO-END & WARNING TRIGGERS                       */
/* -------------------------------------------------------------------------- */

global.triggerLowBalanceWarning = (chatId, secondsLeft = 60) => {
  emitSocketEventGlobal(chatId, ChatEventsEnum.RESERVATION_ENDING_SOON, {
    type: "LOW_BALANCE",
    secondsLeft,
    message:
      secondsLeft <= 30
        ? `Session ending in ${secondsLeft} seconds!`
        : "Low balance – session will end soon",
    timestamp: new Date(),
  });
};

global.triggerSessionAutoEnded = (chatId, sessionId, reservedAmount, ratePerMinute) => {
  const billedMinutes = Math.floor(reservedAmount / ratePerMinute);
  emitSocketEventGlobal(chatId, ChatEventsEnum.SESSION_ENDED_EVENT, {
    sessionId,
    reason: "RESERVATION_EXHAUSTED",
    autoEnded: true,
    totalCost: reservedAmount,
    billedMinutes,
    message: "Session ended: Reserved balance finished",
    timestamp: new Date(),
  });
};