import express from "express";
import {
  createOrGetAOneOnOneChat,
  deleteOneOnOneChat,
  searchAvailableUsers,
  markMessageAsRead,
  getAllChats,
} from "../../controllers/chatapp/chatController.js";
import {
  getAllMessages,
  sendMessage,
  deleteMessage,
  reactToMessage,
} from "../../controllers/chatapp/messageController.js";
import { authMiddleware } from "../../middleware/authmiddleware.js";
import { upload } from "../../middleware/multer.js";

const router = express.Router();

// Apply JWT verification to all routes
router.use(authMiddleware);

// Chat routes
router.route("/one-on-one").post(createOrGetAOneOnOneChat);

router.route("/search-users").get(searchAvailableUsers);

router.route("/").get(getAllChats);

router.route("/:chatId/mark-read").put(markMessageAsRead);

router.route("/:chatId").delete(deleteOneOnOneChat);

// Message routes
router
  .route("/:chatId/messages")
  .get(getAllMessages)
  .post(upload.array("media", 10), sendMessage); // Allow up to 10 files

router.route("/messages/:messageId").delete(deleteMessage);

router.route("/messages/:messageId/react").put(reactToMessage);

export default router;
