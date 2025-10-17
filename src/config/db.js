// import mongoose from 'mongoose';
// import colors from 'colors';

// export let dbInstance = undefined;
// export const connectDB = async () => {
//     try {
//         const connectionInstance = await mongoose.connect(
//             `${process.env.MONGO_URI}`
//         );
//         dbInstance = connectionInstance;
//         console.log(
//             `\n☘️  MongoDB Connected succsessfully!😎\n`.bgGreen.white
//         );
//     } catch (error) {
//         console.log("MongoDB connection error: ", error.red, error);
//         process.exit(1);
//     }
// };



import mongoose from "mongoose";
import logger from "../utils/logger.js";
import {MONGO_URI} from "./constants.js"

const MAX_RETRIES = 5;
let attempts = 0;

const connectDB = async () => {
  try {
    if (!MONGO_URI) {
      logger.error("MONGO_URI not provided in environment variables.");
      process.exit(1);
    }

    if (process.env.NODE_ENV === "development") {
      mongoose.set("debug", true);
    }

    await mongoose.connect(MONGO_URI);

    logger.info("✅ MongoDB connected successfully");

    process.on("SIGINT", async () => {
      await mongoose.connection.close();
      logger.info("🧹 MongoDB connection closed due to app termination");
      process.exit(0);
    });

  } catch (error) {
    logger.error(`❌ MongoDB connection error: ${error.message}`);
    attempts++;

    if (attempts < MAX_RETRIES) {
      const delay = 2000 * attempts;
      logger.warn(`Retrying in ${delay / 1000}s... [Attempt ${attempts}]`);
      setTimeout(connectDB, delay);
    } else {
      logger.error("🔥 Maximum retry attempts reached. Exiting...");
      process.exit(1);
    }
  }
};

export default connectDB;