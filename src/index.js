// index.js
import dotenv from "dotenv";
import logger from "./utils/logger.js";
import connectDB from "./config/db.js";
import { PORT } from "./config/constants.js";
import { createAppServer } from "./app.js";  // ← Import the factory function

dotenv.config({
  path: "./.env",
});

const startServer = async () => {
  try {
    // Connect to MongoDB first
    await connectDB();
    logger.info("MongoDB connected successfully");

    // Then create and start the full server with Socket.IO
    const httpserver = await createAppServer();

    const port = PORT || 8080;
    httpserver.listen(port, '0.0.0.0', () => {
      logger.info(`🚀 Server running on http://localhost:${port} another changes again`);
    });

  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.warn("SIGINT received. Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.warn("SIGTERM received. Shutting down gracefully...");
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled Rejection: ${err}`);
  process.exit(1);
});