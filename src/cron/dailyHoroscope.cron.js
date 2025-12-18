// cron/dailyHoroscope.cron.js
import cron from "node-cron";
import { getDailyHoroscope } from "../controllers/Astrologycontroller/astrologyController.js";
import logger from "../utils/logger.js";

// ⏰ Runs every day at 12:05 AM
cron.schedule("5 0 * * *", async () => {
    try {
        logger.info("🟢 Daily Horoscope Cron Started");

        await getDailyHoroscope({
            sign: "all",
            time: "today",
            type: "general",
        });

        logger.info("✅ Daily Horoscope Cron Completed");
    } catch (error) {
        logger.error("❌ Daily Horoscope Cron Failed", error.message);
    }
});
