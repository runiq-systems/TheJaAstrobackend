import { RechargeHistory } from "../models/Wallet/AstroWallet.js";
import { settleRecharge } from "../services/rechargeSettlement.service.js";

export const runRechargeSettlementJob = async () => {
  const pending = await RechargeHistory.find({
    status: "SUCCESS",
    "meta.settled": { $ne: true },
    "meta.locked": { $ne: true },
  }).limit(50);

  for (const recharge of pending) {
    const locked = await RechargeHistory.updateOne(
      { _id: recharge._id, "meta.locked": { $ne: true } },
      { $set: { "meta.locked": true } }
    );

    if (!locked.modifiedCount) continue;

    try {
      await settleRecharge(recharge._id);
    } catch (err) {
      await RechargeHistory.updateOne(
        { _id: recharge._id },
        {
          $inc: { "meta.settlementAttempts": 1 },
          $unset: { "meta.locked": "" },
        }
      );
      console.error("Settlement failed:", recharge._id, err.message);
    }
  }
};




