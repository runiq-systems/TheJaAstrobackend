import { Payout, RechargeHistory } from "../../models/Wallet/AstroWallet.js";

const getIndianFormattedAmount = (amount) => {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
};

const getTodayRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
};

export const getAdminWallet = async (req, res) => {
  try {
    const { today, tomorrow } = getTodayRange();
    const now = new Date();

    // 1. Total Balance = Sum of all successful recharges ever (completedAt > some old date or all time)
    const allSuccessfulRecharges = await RechargeHistory.find({
      status: 'SUCCESS',
      completedAt: { $exists: true, $lte: now }, // Ensures it's actually completed
    }).select('requestedAmount').lean();

    const totalBalance = allSuccessfulRecharges.reduce((sum, r) => sum + (r.requestedAmount || 0), 0);

    // 2. Money In Today = Total requestedAmount from successful recharges completed TODAY
    const todaySuccessfulRecharges = await RechargeHistory.find({
      status: 'SUCCESS',
      completedAt: { $gte: today, $lt: tomorrow },
    }).lean();

    const moneyInToday = todaySuccessfulRecharges.reduce((sum, r) => sum + (r.requestedAmount || 0), 0);
    const moneyInCountToday = todaySuccessfulRecharges.length;

    // 3. Money Out Today = Total amount from payouts that were SUCCESS today
    // (or APPROVED/PROCESSING → SUCCESS transition today)
    const todaySuccessfulPayouts = await Payout.find({
      status: 'SUCCESS',
      processedAt: { $gte: today, $lt: tomorrow },
    }).lean();

    const moneyOutToday = todaySuccessfulPayouts.reduce((sum, p) => sum + p.amount, 0);
    const moneyOutCountToday = todaySuccessfulPayouts.length;

    // 4. Pending Payouts = Astrologers who raised payout requests (status: REQUESTED or APPROVED)
    const pendingPayoutRequests = await Payout.find({
      status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] },
    }).lean();

    const pendingPayoutAmount = pendingPayoutRequests.reduce((sum, p) => sum + p.amount, 0);
    const pendingAstrologerCount = new Set(pendingPayoutRequests.map(p => p.astrologerId.toString())).size;

    // 5. Payment Methods Breakdown – from today's successful recharges
    const methodMap = todaySuccessfulRecharges.reduce((acc, recharge) => {
      let gateway = (recharge.paymentGateway || 'Unknown').toUpperCase().trim();

      if (gateway.includes('UPI') || gateway.includes('PHONEPE') || gateway.includes('GPAY') || gateway.includes('PAYTM')) {
        acc.UPI = (acc.UPI || 0) + (recharge.requestedAmount || 0);
      } else if (gateway.includes('CARD') || gateway.includes('CREDIT') || gateway.includes('DEBIT')) {
        acc.CARD = (acc.CARD || 0) + (recharge.requestedAmount || 0);
      } else if (gateway.includes('NETBANKING') || gateway.includes('NB') || gateway.includes('BANK')) {
        acc.NETBANKING = (acc.NETBANKING || 0) + (recharge.requestedAmount || 0);
      } else {
        acc.OTHER = (acc.OTHER || 0) + (recharge.requestedAmount || 0);
      }
      return acc;
    }, { UPI: 0, CARD: 0, NETBANKING: 0, OTHER: 0 });

    const totalTodayRecharge = moneyInToday || 1;

    const paymentMethodsBreakdown = [
      { method: 'UPI', amount: methodMap.UPI, color: '#0D1B52' },
      { method: 'Card Payment', amount: methodMap.CARD, color: '#E3C46F' },
      { method: 'Net Banking', amount: methodMap.NETBANKING, color: '#6E6E6E' },
    ]
      .map(item => ({
        method: item.method,
        amount: getIndianFormattedAmount(item.amount),
        percentage: Math.round((item.amount / totalTodayRecharge) * 100),
        color: item.color,
      }))
      .sort((a, b) => b.percentage - a.percentage); // Most used first

    // Fallback if no data today
    if (moneyInToday === 0) {
      paymentMethodsBreakdown[0].percentage = 65;
      paymentMethodsBreakdown[1].percentage = 25;
      paymentMethodsBreakdown[2].percentage = 10;
    }

    // 6. Recent Transactions – Mix of major platform events (recharges + payouts + refunds)
    const recentRecharges = await RechargeHistory.find({ status: 'SUCCESS' })
      .sort({ completedAt: -1 })
      .limit(8)
      .lean();

    const recentPayouts = await Payout.find({ status: 'SUCCESS' })
      .sort({ processedAt: -1 })
      .limit(8)
      .lean();

    // Combine and sort by time, take top 10
    const combinedEvents = [
      ...recentRecharges.map(r => ({
        ...r,
        eventType: 'RECHARGE',
        time: r.completedAt || r.updatedAt,
        amount: r.requestedAmount,
        userName: r.meta?.userName || 'User',
        method: r.paymentGateway,
      })),
      ...recentPayouts.map(p => ({
        ...p,
        eventType: 'PAYOUT',
        time: p.processedAt || p.updatedAt,
        amount: -p.amount,
        userName: p.meta?.astrologerName || 'Astrologer',
        method: p.method,
      })),
    ];

    const recentTransactions = combinedEvents
      .sort((a, b) => b.time - a.time)
      .slice(0, 10)
      .map(event => ({
        id: event._id.toString(),
        type: event.eventType === 'RECHARGE' ? 'User Payment' : 'Astrologer Payout',
        user: event.userName,
        amount: event.amount > 0 
          ? `+${getIndianFormattedAmount(event.amount)}` 
          : getIndianFormattedAmount(Math.abs(event.amount)),
        date: event.time.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: event.time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        method: event.eventType === 'RECHARGE' 
          ? (event.method?.includes('UPI') ? 'UPI' : event.method?.includes('CARD') ? 'Card' : 'Net Banking')
          : 'Bank Transfer',
      }));

    res.json({
      totalBalance: getIndianFormattedAmount(totalBalance),
      moneyInToday: {
        amount: getIndianFormattedAmount(moneyInToday),
        count: moneyInCountToday,
      },
      moneyOutToday: {
        amount: getIndianFormattedAmount(moneyOutToday),
        count: moneyOutCountToday,
      },
      pendingPayouts: {
        amount: getIndianFormattedAmount(pendingPayoutAmount),
        astrologerCount: pendingAstrologerCount,
      },
      paymentMethodsBreakdown,
      recentTransactions,
      lastUpdated: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Wallet Dashboard Error:', error);
    res.status(500).json({ message: 'Failed to load dashboard data', error: error.message });
  }
};