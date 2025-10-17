import express from "express";
import logger from "../utils/logger.js";

const router = express.Router();

router.get("/", (req, res) => {
  try {
    return res.status(201).json({
      success: true,
      message: "This is Index page",
    });
  } catch (error) {
    logger.error(`Error occurred in app.js: ${error.message}`);
  }
});

export default router;
