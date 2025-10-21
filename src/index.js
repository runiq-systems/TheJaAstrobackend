import dotenv from "dotenv";
import logger from "./utils/logger.js";
import connectDB from "./config/db.js";
import { PORT } from "./config/constants.js";
import { createServer } from "http";
import httpserver from "./app.js";

dotenv.config({
  path: "./.env",
});

const majorNodeVersion = +process.env.NODE_VERSION?.split(".")[0] || 0;


const startServer = async () => {
  httpserver.listen(PORT || 8080, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
};

if (majorNodeVersion >= 14) {
  try {
    await connectDB();
    startServer();
  } catch (err) {
    logger.info("Mongo db connection error: ", err);
  }
} else {
  connectDB()
    .then(() => {
      startServer();
    })
    .catch((err) => {
      logger.info("Mongo db connection error: ", err);
    });
}

process.on("unhandledRejection", (err) => {
  logger.error(`Uncaught Handle Rejection: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});
process.on("SIGINT", shutdown);


async function shutdown() {
  logger.warn("Trying to shutdown the Server gracefully...");
  try {
    server.close(() => {
      logger.info("HTTP Server Closed");
    });

    await mongoose.connection.exit();
    logger.info("Connection closed Successfully");
    process.exit(0);
  } catch (error) {
    logger.error(`Error occurred, Exiting the Server...`);
    process.exit(1);
  }
}