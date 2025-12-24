import mongoose from "mongoose";
import { Payout, PayoutAccount } from "../../models/Wallet/AstroWallet.js";
import {User} from "../../models/user.js"

export const getPayouts = async (req, res) => {
  try {
    const { 
      status, 
      astrologerId, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 20 
    } = req.query;

    const query = {};

    if (status && status !== 'ALL') {
      query.status = status;
    }

    if (astrologerId && mongoose.isValidObjectId(astrologerId)) {
      query.astrologerId = astrologerId;
    }

    if (startDate) {
      query.createdAt = { ...query.createdAt, $gte: new Date(startDate) };
    }

    if (endDate) {
      query.createdAt = { ...query.createdAt, $lte: new Date(endDate) };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payouts = await Payout.find(query)
      .populate('astrologerId', 'name phone email')
      .populate('payoutAccount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payout.countDocuments(query);

    res.json({
      success: true,
      data: payouts,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get payouts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createManualPayout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { astrologerId, amount, method, payoutAccountId, note } = req.body;
    // const adminId = req.user.id; // assuming you have authenticated admin

    // 1. Validate astrologer exists
    const astrologer = await User.findById(astrologerId).session(session);
    if (!astrologer || astrologer.role !== 'astrologer') {
      throw new Error('Invalid astrologer');
    }

    // 2. Validate payout account
    const account = await PayoutAccount.findOne({
      _id: payoutAccountId,
      astrologerId
    }).session(session);

    if (!account) {
      throw new Error('Payout account not found or does not belong to this astrologer');
    }

    // 3. Basic business validation
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const payout = new Payout({
      astrologerId,
      amount,
      currency: 'INR',
      fee: 0,           // can be calculated later if needed
      tax: 0,
      netAmount: amount,
      method,
      payoutAccount: payoutAccountId,
      status: 'REQUESTED',
      transactionIds: [], // you might generate one here
      processedAt: new Date(),
      meta: {
        initiatedBy: 'MANUAL_ADMIN',
        adminNote: note || 'Manual payout initiated by admin',
        ipAddress: req.ip
      }
    });

    await payout.save({ session });

    // Optional: you could also create a wallet transaction here
    // await createDebitTransaction(...);

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: 'Manual payout request created',
      data: payout
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Manual payout error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create manual payout'
    });
  } finally {
    session.endSession();
  }
};


// {
//   "astrologerId": "6922f18b06b3070df3874194",
//   "amount": 20,
//   "method": "BANK_TRANSFER",
//   "payoutAccountId": "693b1235c37748be02095e63",
//   "note": "Hello world!"
// }