import { ChatEventsEnum } from "../../constants.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import { emitSocketEvent } from "../../socket/index.js";
class SessionTimerService {
    constructor() {
        this.activeTimers = new Map();
        this.billingIntervals = new Map();
    }

    // Start billing for a session
    async startBilling(sessionId, chatId, ratePerMinute) {
        if (this.billingIntervals.has(sessionId)) {
            console.log(`Billing already active for session: ${sessionId}`);
            return;
        }

        console.log(`Starting billing for session: ${sessionId}`);

        // Bill every minute
        const interval = setInterval(async () => {
            try {
                const session = await ChatSession.findOne({ sessionId, status: "ACTIVE" });

                if (!session || session.status !== "ACTIVE") {
                    this.stopBilling(sessionId);
                    return;
                }

                // Update billed duration
                await ChatSession.findByIdAndUpdate(session._id, {
                    $inc: { billedDuration: 60 }, // Add 60 seconds
                    lastActivityAt: new Date()
                });

                // Calculate current cost
                const currentCost = session.calculateCurrentCost();

                // Notify clients about billing update
                emitSocketEvent({ app: { get: () => global.io } }, chatId, ChatEventsEnum.BILLING_UPDATE_EVENT, {
                    sessionId,
                    billedDuration: session.billedDuration + 60,
                    currentCost,
                    ratePerMinute
                });

                console.log(`Billed session ${sessionId}: ${session.billedDuration + 60}s, ₹${currentCost}`);

            } catch (error) {
                console.error(`Billing error for session ${sessionId}:`, error);
                this.stopBilling(sessionId);
            }
        }, 60000); // Every minute

        this.billingIntervals.set(sessionId, interval);
    }

    // Stop billing for a session
    stopBilling(sessionId) {
        const interval = this.billingIntervals.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.billingIntervals.delete(sessionId);
            console.log(`Stopped billing for session: ${sessionId}`);
        }
    }

    // Handle astrologer leaving chat (pause session)
    async pauseSession(sessionId, chatId) {
        const session = await ChatSession.findOne({ sessionId });

        if (session && session.status === "ACTIVE") {
            await session.pauseSession();
            this.stopBilling(sessionId);

            emitSocketEvent({ app: { get: () => global.io } }, chatId, ChatEventsEnum.SESSION_PAUSED_EVENT, {
                sessionId,
                pausedAt: new Date()
            });

            console.log(`Session paused: ${sessionId}`);
        }
    }

    // Handle astrologer returning to chat (resume session)
    async resumeSession(sessionId, chatId, ratePerMinute) {
        const session = await ChatSession.findOne({ sessionId });

        if (session && session.status === "PAUSED") {
            await session.resumeSession();
            this.startBilling(sessionId, chatId, ratePerMinute);

            emitSocketEvent({ app: { get: () => global.io } }, chatId, ChatEventsEnum.SESSION_RESUMED_EVENT, {
                sessionId,
                resumedAt: new Date()
            });

            console.log(`Session resumed: ${sessionId}`);
        }
    }

    // Clean up all intervals (on server shutdown)
    cleanup() {
        for (const [sessionId, interval] of this.billingIntervals) {
            clearInterval(interval);
            console.log(`Cleaned up billing for session: ${sessionId}`);
        }
        this.billingIntervals.clear();
    }
}

export const sessionTimerService = new SessionTimerService();