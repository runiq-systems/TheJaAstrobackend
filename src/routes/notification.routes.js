// routes/notification.routes.js
import express from "express";
import { sendNotification } from "../controllers/sendNotification.js";
const router = express.Router();

router.post("/send-notification", sendNotification);

export default router;
