import express from "express";
import {
    getAppSettings,
    upsertAppSettings,
} from "../controllers/appSettings.controller.js";
import path from "path";
import multer from "multer";
import { adminMiddleware } from "../middleware/authmiddleware.js";
const router = express.Router();
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Make sure this directory exists
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only images (jpeg, jpg, png, webp) are allowed'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    }
});

// Admin only (recommended)
router.get("/", getAppSettings);
router.patch("/", upload.fields([
    { name: "homefirstpageBanner", maxCount: 1 },
    { name: "homesecondpageBanner", maxCount: 1 },
]), upsertAppSettings); // 🔥 CREATE + UPDATE SAME API

export default router;
