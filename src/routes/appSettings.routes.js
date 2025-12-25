import express from "express";
import {
    getAppSettings,
    upsertAppSettings,
} from "../controllers/appSettings.controller.js";

const router = express.Router();

// Admin only (recommended)
router.get("/", getAppSettings);
router.post("/", upsertAppSettings); // 🔥 CREATE + UPDATE SAME API

export default router;
