import cron from "node-cron";
import { ChatRequest } from "../models/chatRequest.js";
import { ChatSession } from "../models/chatSession.js";
import { emitSocketEvent } from "../socket/index.js";
import { ChatEventsEnum } from "../constants.js";

// Check for expired requests every minute
cron.schedule("* * * * *", async () => {
    try {
        const now = new Date();

        // Find expired pending requests
        const expiredRequests = await ChatRequest.find({
            status: "PENDING",
            expiresAt: { $lte: now }
        });

        for (const request of expiredRequests) {
            // Mark request as expired
            await ChatRequest.findByIdAndUpdate(request._id, {
                status: "EXPIRED"
            });

            // Mark session as missed
            await ChatSession.findByIdAndUpdate(request.sessionId, {
                status: "MISSED"
            });

            // Notify astrologer about missed chat
            emitSocketEvent({ app: { get: () => global.io } }, request.astrologerId.toString(), ChatEventsEnum.MISSED_CHAT_EVENT, {
                requestId: request.requestId,
                userId: request.userId
            });

            console.log(`Marked request as expired: ${request.requestId}`);
        }
    } catch (error) {
        console.error("Error processing expired requests:", error);
    }
});

// Clean up completed sessions older than 30 days (optional)
cron.schedule("0 2 * * *", async () => { // Daily at 2 AM
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await ChatSession.deleteMany({
            status: "COMPLETED",
            updatedAt: { $lte: thirtyDaysAgo }
        });

        console.log(`Cleaned up ${result.deletedCount} old chat sessions`);
    } catch (error) {
        console.error("Error cleaning up old sessions:", error);
    }
});