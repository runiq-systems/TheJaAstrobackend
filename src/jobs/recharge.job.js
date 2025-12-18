import cron from "node-cron";
import { runRechargeSettlementJob } from "./rechargeSettlement.job.js";
cron.schedule("*/1 * * * *", async () => {
    await runRechargeSettlementJob();
});
