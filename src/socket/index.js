// // socketServer.js
// import cookie from "cookie";
// import jwt from "jsonwebtoken";
// import { Server } from "socket.io";
// import { ChatEventsEnum } from "../constants.js";
// import { User } from "../models/user.js";
// import { ApiError } from "../utils/ApiError.js";
// import logger from "../utils/logger.js";
// import { ChatSession } from "../models/chatapp/chatSession.js";
// import { startChatSession } from "../controllers/chatapp/chatSessionController.js";
// /* -------------------------------------------------------------------------- */
// /*                          🔧  SOCKET EVENT MOUNTERS                         */
// /* -------------------------------------------------------------------------- */

// /**
//  * @description Handle user joining a specific chat room
//  * @param {Socket} socket
//  */
// const mountJoinChatEvent = (socket) => {
//   socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, (data) => {
//     let chatId = typeof data === "string" ? data : data?.chatId;

//     if (!chatId) {
//       console.warn("Invalid JOIN_CHAT_EVENT payload:", data);
//       return;
//     }

//     console.log(`User ${socket.user._id} joined chat: ${chatId}`);
//     socket.join(String(chatId));
//   });
// };

// /**
//  * @description Handle typing indicator in chat
//  * @param {Socket} socket
//  */
// const mountTypingEvents = (socket) => {
//   // Typing started
//   socket.on(ChatEventsEnum.TYPING_EVENT, (chatId) => {
//     socket.to(chatId).emit(ChatEventsEnum.TYPING_EVENT, {
//       chatId,
//       userId: socket.user._id,
//       username: socket.user.username,
//       typing: true,
//       timestamp: new Date(),
//     });
//     logger.info(`User is typing in chat ${chatId}`);
//   });

//   // Typing stopped
//   socket.on(ChatEventsEnum.STOP_TYPING_EVENT, (chatId) => {
//     socket.to(chatId).emit(ChatEventsEnum.STOP_TYPING_EVENT, {
//       chatId,
//       userId: socket.user._id,
//       username: socket.user.username,
//       typing: false,
//       timestamp: new Date(),
//     });
//   });
// };

// /**
//  * @description Handle message read status updates
//  * @param {Socket} socket
//  */
// const mountMessageReadEvent = (socket) => {
//   socket.on(ChatEventsEnum.MESSAGE_READ_EVENT, ({ messageId, chatId }) => {
//     socket.to(chatId).emit(ChatEventsEnum.MESSAGE_READ_EVENT, {
//       messageId,
//       chatId,
//       readBy: socket.user._id,
//       readAt: new Date(),
//     });
//   });
// };

// // In your socket initialization file
// const mountChatSessionEvents = (socket) => {
//   socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, async ({ chatId, sessionId }) => {
//     try {
//       socket.join(chatId);

//       console.log(`User joined chat: ${chatId}, session: ${sessionId}`);

//       // REST API will start session — NOT SOCKET
//       socket.to(chatId).emit(ChatEventsEnum.USER_JOINED_EVENT, {
//         chatId,
//         sessionId,
//         userId: socket.user._id
//       });

//     } catch (error) {
//       console.error("Error joining chat:", error);
//     }
//   });
// };

// // Add this to your socket connection handler

// /**
//  * @description Handle all group-related chat events (create, update, delete, etc.)
//  * @param {Socket} socket
//  */
// const mountGroupChatEvents = (socket) => {
//   // Join Request
//   socket.on(ChatEventsEnum.JOIN_REQUEST_EVENT, (data) => {
//     data.chat.admins.forEach((adminId) => {
//       socket.to(adminId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_EVENT, data);
//     });
//   });

//   // Join Request Approved
//   socket.on(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, (data) => {
//     socket.to(data.userId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, data);
//     data.chat.admins.forEach((adminId) => {
//       socket.to(adminId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, data);
//     });
//   });

//   // Join Request Rejected
//   socket.on(ChatEventsEnum.JOIN_REQUEST_REJECTED_EVENT, (data) => {
//     socket.to(data.userId.toString()).emit(ChatEventsEnum.JOIN_REQUEST_REJECTED_EVENT, data);
//   });

//   // New Group Chat Created
//   socket.on(ChatEventsEnum.NEW_GROUP_CHAT_EVENT, (groupChat) => {
//     groupChat.participants.forEach((participantId) => {
//       if (participantId.toString() !== socket.user._id.toString()) {
//         socket.to(participantId.toString()).emit(ChatEventsEnum.NEW_GROUP_CHAT_EVENT, groupChat);
//       }
//     });
//   });

//   // Group Chat Updated
//   socket.on(ChatEventsEnum.UPDATE_GROUP_EVENT, (groupChat) => {
//     groupChat.participants.forEach((participantId) => {
//       socket.to(participantId.toString()).emit(ChatEventsEnum.UPDATE_GROUP_EVENT, groupChat);
//     });
//   });

//   // User Removed
//   socket.on(ChatEventsEnum.REMOVED_FROM_GROUP_EVENT, (data) => {
//     socket.to(data.userId.toString()).emit(ChatEventsEnum.REMOVED_FROM_GROUP_EVENT, data);
//   });

//   // User Left Group
//   socket.on(ChatEventsEnum.LEFT_GROUP_EVENT, (data) => {
//     socket.to(data.userId.toString()).emit(ChatEventsEnum.LEFT_GROUP_EVENT, data);
//   });

//   // Group Deleted
//   socket.on(ChatEventsEnum.GROUP_DELETED_EVENT, (data) => {
//     data.participants.forEach((participantId) => {
//       socket.to(participantId.toString()).emit(ChatEventsEnum.GROUP_DELETED_EVENT, data);
//     });
//   });

//   // Group Message Received
//   socket.on(ChatEventsEnum.GROUP_MESSAGE_RECEIVED_EVENT, (data) => {
//     socket.to(data.chatId).emit(ChatEventsEnum.GROUP_MESSAGE_RECEIVED_EVENT, data);
//   });
// };

// /* -------------------------------------------------------------------------- */
// /*                          🚀  SOCKET SERVER CORE                            */
// /* -------------------------------------------------------------------------- */

// /**
//  * @description Initialize Socket.IO server and handle connections
//  * @param {Server} io
//  */
// export const initializeSocketIO = (io) => {
//   io.on("connection", async (socket) => {
//     try {
//       // Parse cookies from headers (works with withCredentials: true)
//       const cookies = cookie.parse(socket.handshake.headers?.cookie || "");
//       let token = cookies?.accessToken || socket.handshake.auth?.token;

//       if (!token) throw new ApiError(401, "Unauthorized: Token missing");

//       // Verify JWT
//       const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
//       const user = await User.findById(decoded?.id).select("-password -refreshToken");
//       // console.log("decoded", decoded)
//       // console.log("Decoded user :", user);

//       if (!user) throw new ApiError(401, "Unauthorized: Invalid user");

//       // Attach user to socket
//       socket.user = user;
//       socket.join(user._id.toString());
//       // console.log(`🟢 User connected:  (${user._id})`);

//       // Notify client that connection is established
//       socket.emit(ChatEventsEnum.CONNECTED_EVENT, { userId: user._id });

//       /* -------------------------------- Mount events ------------------------------- */
//       mountJoinChatEvent(socket);
//       mountTypingEvents(socket);
//       mountMessageReadEvent(socket);
//       mountGroupChatEvents(socket);
//       mountChatSessionEvents(socket);
//       // logger.info(`Socket connected: (${socket.user})`);
//       /* ------------------------------- Disconnect event ----------------------------- */
//       socket.on(ChatEventsEnum.DISCONNECT_EVENT, () => {
//         console.log(`🔴 User disconnected: ${socket.user?.username} (${socket.user?._id})`);
//         socket.leave(socket.user._id.toString());
//       });

//     } catch (error) {
//       console.error("❌ Socket connection error:", error.message);
//       socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, error?.message || "Socket connection failed");
//     }
//   });
// };

// /* -------------------------------------------------------------------------- */
// /*                        🎯  UTILITY EMIT FUNCTION                           */
// /* -------------------------------------------------------------------------- */

// /**
//  * @description Emit a socket event to a specific room from a REST API
//  * @param {import("express").Request} req - Express request (with io instance)
//  * @param {string} roomId - Room ID or user ID
//  * @param {string} event - Event name from ChatEventsEnum
//  * @param {any} payload - Event data
//  */
// export const emitSocketEvent = (req, roomId, event, payload) => {
//   try {
//     const io = req.app.get("io");
//     io.in(roomId).emit(event, payload);
//     console.log(`📤 Event emitted: ${payload} -> Room: ${event}`);
//   } catch (error) {
//     console.error("❌ Failed to emit socket event:", error);
//   }
// };

// export const emitSocketEventGlobal = (roomId, event, payload) => {
//   try {
//     const io = global.io;

//     if (!io) {
//       console.error("❌ global.io not initialized");
//       return;
//     }

//     io.in(roomId).emit(event, payload);
//     console.log(`📤 [GLOBAL EMIT] ${event} -> Room: ${roomId}`);
//   } catch (error) {
//     console.error("❌ Global emit error:", error);
//   }
// };

// socketServer.js
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { ChatEventsEnum } from '../constants.js';
import { User } from '../models/user.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { ChatSession } from '../models/chatapp/chatSession.js';
import { startChatSession } from '../controllers/chatapp/chatSessionController.js';
import { Chat } from '../models/chatapp/chat.js';
import { Message } from '../models/chatapp/message.js';

/* -------------------------------------------------------------------------- */
/*                          🔧  SOCKET EVENT MOUNTERS                         */
/* -------------------------------------------------------------------------- */

/**
 * @description Handle user joining a specific chat room
 * @param {Socket} socket
 */
const mountJoinChatEvent = (socket) => {
  socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, (data) => {
    let chatId = typeof data === 'string' ? data : data?.chatId;

    if (!chatId) {
      console.warn('Invalid JOIN_CHAT_EVENT payload:', data);
      return;
    }

    console.log(`User ${socket.user._id} joined chat: ${chatId}`);
    socket.join(String(chatId));
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
    logger.info(`User is typing in chat ${chatId}`);
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
/**
 * @description Handle message read status updates (single message)
 * @param {Socket} socket
 */
const mountMessageReadEvent = (socket) => {
  socket.on(
    ChatEventsEnum.MESSAGE_READ_EVENT,
    async ({ messageId, chatId }) => {
      try {
        if (!messageId || !chatId) {
          return socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
            message: 'Message ID and Chat ID are required',
          });
        }

        const userId = socket.user._id;

        // Find the chat to verify user is a participant
        const chat = await Chat.findOne({
          _id: chatId,
          participants: userId,
        });

        if (!chat) {
          return socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
            message: 'Chat not found or access denied',
          });
        }

        // Mark the specific message as read
        const message = await Message.findById(messageId);
        if (message && message.chat.toString() === chatId) {
          // Check if already read
          const isAlreadyRead = message.readBy?.some(
            (read) => read.user.toString() === userId.toString()
          );

          if (!isAlreadyRead) {
            await message.markAsRead(userId);

            console.log(`Message ${messageId} marked as read by ${userId}`);

            // Update chat's lastRead timestamp
            await Chat.findByIdAndUpdate(chatId, {
              $set: {
                [`lastRead.${userId}`]: new Date(),
              },
            });

            // Notify the sender
            socket
              .to(message.sender.toString())
              .emit(ChatEventsEnum.MESSAGE_READ_EVENT, {
                chatId,
                messageId: message._id,
                readBy: userId,
                readAt: new Date(),
                isSingleMessage: true,
              });

            // Also emit to chat room for real-time updates
            socket.to(chatId).emit(ChatEventsEnum.MESSAGE_READ_UPDATE_EVENT, {
              chatId,
              messageId: message._id,
              readBy: userId,
              readAt: new Date(),
            });

            // Send confirmation to user
            socket.emit(ChatEventsEnum.MESSAGE_READ_CONFIRMATION, {
              success: true,
              messageId,
              chatId,
              readAt: new Date(),
            });
          }
        }
      } catch (error) {
        console.error('Error marking message as read:', error);
        socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
          message: 'Failed to mark message as read',
          error: error.message,
        });
      }
    }
  );
};

// In your socket initialization file
const mountChatSessionEvents = (socket) => {
  socket.on(ChatEventsEnum.JOIN_CHAT_EVENT, async ({ chatId, sessionId }) => {
    try {
      socket.join(chatId);

      console.log(`User joined chat: ${chatId}, session: ${sessionId}`);

      // REST API will start session — NOT SOCKET
      socket.to(chatId).emit(ChatEventsEnum.USER_JOINED_EVENT, {
        chatId,
        sessionId,
        userId: socket.user._id,
      });
    } catch (error) {
      console.error('Error joining chat:', error);
    }
  });
};

/* -------------------------------------------------------------------------- */
/*                    📖 MARK ALL MESSAGES AS READ HANDLER                    */
/* -------------------------------------------------------------------------- */

/**
 * @description Handle marking all messages in a chat as read
 * @param {Socket} socket
 */
const mountMarkAllMessagesReadEvent = (socket) => {
  socket.on(ChatEventsEnum.MARK_ALL_READ_EVENT, async ({ chatId }) => {
    try {
      if (!chatId) {
        return socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
          message: 'Chat ID is required',
        });
      }

      const userId = socket.user._id;

      console.log(
        `User ${userId} marking all messages as read in chat ${chatId}`
      );

      // Find the chat to verify user is a participant
      const chat = await Chat.findOne({
        _id: chatId,
        participants: userId,
      });

      if (!chat) {
        return socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
          message: 'Chat not found or access denied',
        });
      }

      // Update all messages sent by others that haven't been read
      const updateResult = await Message.updateMany(
        {
          chat: chatId,
          sender: { $ne: userId },
          'readBy.user': { $ne: userId },
        },
        {
          $addToSet: {
            readBy: {
              user: userId,
              readAt: new Date(),
            },
          },
          $set: {
            status: 'read',
          },
        }
      );

      console.log(
        `Marked ${updateResult.modifiedCount} messages as read for user ${userId}`
      );

      // Update chat's lastRead timestamp
      await Chat.findByIdAndUpdate(chatId, {
        $set: {
          [`lastRead.${userId}`]: new Date(),
        },
      });

      // Notify other participant(s) that all their messages were read
      const distinctSenders = await Message.distinct('sender', {
        chat: chatId,
        sender: { $ne: userId },
        'readBy.user': userId,
      });

      // Emit to each sender
      distinctSenders.forEach((senderId) => {
        if (senderId.toString() !== userId.toString()) {
          socket
            .to(senderId.toString())
            .emit(ChatEventsEnum.BULK_MESSAGES_READ_EVENT, {
              chatId,
              readerId: userId,
              readAt: new Date(),
              messageCount: updateResult.modifiedCount,
              isBulk: true,
            });
        }
      });

      // Also emit to the chat room
      socket.to(chatId).emit(ChatEventsEnum.BULK_MESSAGES_READ_EVENT, {
        chatId,
        readerId: userId,
        readAt: new Date(),
        messageCount: updateResult.modifiedCount,
        isBulk: true,
      });

      // Send confirmation to the user who marked messages as read
      socket.emit(ChatEventsEnum.MARK_ALL_READ_CONFIRMATION, {
        success: true,
        chatId,
        modifiedCount: updateResult.modifiedCount,
        timestamp: new Date(),
      });

      logger.info(
        `User ${userId} marked ${updateResult.modifiedCount} messages as read in chat ${chatId}`
      );
    } catch (error) {
      console.error('Error marking all messages as read:', error);
      socket.emit(ChatEventsEnum.SOCKET_ERROR_EVENT, {
        message: 'Failed to mark all messages as read',
        error: error.message,
      });
    }
  });
};

// Add this to your socket connection handler

/**
 * @description Handle all group-related chat events (create, update, delete, etc.)
 * @param {Socket} socket
 */
const mountGroupChatEvents = (socket) => {
  // Join Request
  socket.on(ChatEventsEnum.JOIN_REQUEST_EVENT, (data) => {
    data.chat.admins.forEach((adminId) => {
      socket
        .to(adminId.toString())
        .emit(ChatEventsEnum.JOIN_REQUEST_EVENT, data);
    });
  });

  // Join Request Approved
  socket.on(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, (data) => {
    socket
      .to(data.userId.toString())
      .emit(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, data);
    data.chat.admins.forEach((adminId) => {
      socket
        .to(adminId.toString())
        .emit(ChatEventsEnum.JOIN_REQUEST_APPROVED_EVENT, data);
    });
  });

  // Join Request Rejected
  socket.on(ChatEventsEnum.JOIN_REQUEST_REJECTED_EVENT, (data) => {
    socket
      .to(data.userId.toString())
      .emit(ChatEventsEnum.JOIN_REQUEST_REJECTED_EVENT, data);
  });

  // New Group Chat Created
  socket.on(ChatEventsEnum.NEW_GROUP_CHAT_EVENT, (groupChat) => {
    groupChat.participants.forEach((participantId) => {
      if (participantId.toString() !== socket.user._id.toString()) {
        socket
          .to(participantId.toString())
          .emit(ChatEventsEnum.NEW_GROUP_CHAT_EVENT, groupChat);
      }
    });
  });

  // Group Chat Updated
  socket.on(ChatEventsEnum.UPDATE_GROUP_EVENT, (groupChat) => {
    groupChat.participants.forEach((participantId) => {
      socket
        .to(participantId.toString())
        .emit(ChatEventsEnum.UPDATE_GROUP_EVENT, groupChat);
    });
  });

  // User Removed
  socket.on(ChatEventsEnum.REMOVED_FROM_GROUP_EVENT, (data) => {
    socket
      .to(data.userId.toString())
      .emit(ChatEventsEnum.REMOVED_FROM_GROUP_EVENT, data);
  });

  // User Left Group
  socket.on(ChatEventsEnum.LEFT_GROUP_EVENT, (data) => {
    socket
      .to(data.userId.toString())
      .emit(ChatEventsEnum.LEFT_GROUP_EVENT, data);
  });

  // Group Deleted
  socket.on(ChatEventsEnum.GROUP_DELETED_EVENT, (data) => {
    data.participants.forEach((participantId) => {
      socket
        .to(participantId.toString())
        .emit(ChatEventsEnum.GROUP_DELETED_EVENT, data);
    });
  });

  // Group Message Received
  socket.on(ChatEventsEnum.GROUP_MESSAGE_RECEIVED_EVENT, (data) => {
    socket
      .to(data.chatId)
      .emit(ChatEventsEnum.GROUP_MESSAGE_RECEIVED_EVENT, data);
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
  io.on('connection', async (socket) => {
    try {
      // Parse cookies from headers (works with withCredentials: true)
      const cookies = cookie.parse(socket.handshake.headers?.cookie || '');
      let token = cookies?.accessToken || socket.handshake.auth?.token;

      if (!token) throw new ApiError(401, 'Unauthorized: Token missing');

      // Verify JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(decoded?.id).select(
        '-password -refreshToken'
      );
      // console.log("decoded", decoded)
      // console.log("Decoded user :", user);

      if (!user) throw new ApiError(401, 'Unauthorized: Invalid user');

      // Attach user to socket
      socket.user = user;
      socket.join(user._id.toString());
      // console.log(`🟢 User connected:  (${user._id})`);

      // Notify client that connection is established
      socket.emit(ChatEventsEnum.CONNECTED_EVENT, { userId: user._id });

      /* -------------------------------- Mount events ------------------------------- */
      mountJoinChatEvent(socket);
      mountTypingEvents(socket);
      mountMessageReadEvent(socket); // Single message read
      mountMarkAllMessagesReadEvent(socket); // NEW: Bulk mark as read
      mountGroupChatEvents(socket);
      mountChatSessionEvents(socket);
      // logger.info(`Socket connected: (${socket.user})`);
      /* ------------------------------- Disconnect event ----------------------------- */
      // socket.on(ChatEventsEnum.DISCONNECT_EVENT, () => {
      //   console.log(`🔴 User disconnected: ${socket.user?.username} (${socket.user?._id})`);
      //   socket.leave(socket.user._id.toString());
      // });

      socket.on(ChatEventsEnum.DISCONNECT_EVENT, (reason) => {
        logger.warn('Socket disconnected', {
          userId: socket.user?._id,
          reason,
        });
      });
    } catch (error) {
      console.error('❌ Socket connection error:', error.message);
      socket.emit(
        ChatEventsEnum.SOCKET_ERROR_EVENT,
        error?.message || 'Socket connection failed'
      );
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
    const io = req.app.get('io');
    io.in(roomId).emit(event, payload);
    console.log(`📤 Event emitted: ${payload} -> Room: ${event}`);
  } catch (error) {
    console.error('❌ Failed to emit socket event:', error);
  }
};

export const emitSocketEventGlobal = (roomId, event, payload) => {
  try {
    const io = global.io;

    if (!io) {
      console.error('❌ global.io not initialized');
      return;
    }

    io.in(roomId).emit(event, payload);
    console.log(`📤 [GLOBAL EMIT] ${event} -> Room: ${roomId}`);
  } catch (error) {
    console.error('❌ Global emit error:', error);
  }
};
