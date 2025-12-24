import { startOfDay, subDays } from 'date-fns';
import { User } from '../../models/user.js';
import mongoose from "mongoose";
import {
  Wallet,
  Transaction,
  Ledger,
  WalletAudit,
  generateTxId,
} from '../../models/Wallet/AstroWallet.js';
import { KundaliReport } from '../../models/kunadliReport.js';
import { KundaliMatching } from '../../models/kundaliMatching.js';

export const getAllAdminUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '', // active, inactive, blocked
      sortBy = 'lastSeen', // or createdAt, totalSpent, etc.
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = { role: 'user' }; // only regular users

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      filter.userStatus = status; // Active, InActive, Blocked
    }

    // Sort options
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get users with pagination
    const users = await User.find(filter)
      .select('fullName phone userStatus lastSeen createdAt isOnline')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Calculate total spent per user (from wallet transactions)
    const userIds = users.map((u) => u._id);

    // Fetch wallets
    const wallets = await Wallet.find({ userId: { $in: userIds } }).select('userId balances');

    // Create balance map safely
    const balanceMap = new Map();

    wallets.forEach((wallet) => {
      const userIdStr = wallet.userId.toString();

      // Safely get INR available balance
      let availableBalance = 0;

      if (wallet.balances && Array.isArray(wallet.balances)) {
        const inrBalance = wallet.balances.find(b => b.currency === 'INR');
        availableBalance = inrBalance?.available || 0;
      }

      balanceMap.set(userIdStr, availableBalance);
    });

    const transactions = await Transaction.aggregate([
      {
        $match: {
          userId: { $in: userIds },
          status: 'SUCCESS', // Only successful transactions
        },
      },
      { $sort: { createdAt: -1 } }, // Most recent first
      {
        $group: {
          _id: '$userId',
          lastTransactions: {
            $push: {
              txId: '$txId',
              type: '$type',
              category: '$category',
              amount: '$amount',
              description: '$description',
              status: '$status',
              createdAt: '$createdAt',
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          lastTransactions: { $slice: ['$lastTransactions', 4] }, // Keep only last 4
        },
      },
    ]);

    const transactionMap = new Map(
      transactions.map(t => [t._id.toString(), t.lastTransactions])
    );
    const formattedUsers = users.map((user) => {
      const userIdStr = user._id.toString();
      return {
        _id: user._id,
        fullName: user.fullName || 'Unknown',
        phone: user.phone || '-',
        status: user.userStatus || 'InActive',
        lastActive: user.lastSeen ? user.lastSeen.toISOString() : '-',
        balance: balanceMap.get(userIdStr) || 0,
        joinedOn: user.createdAt.toISOString(),
        isOnline: user.isOnline || false,
        lastTransactions: transactionMap.get(userIdStr) || [],
      };
    });

    // Total count for pagination
    const total = await User.countDocuments(filter);

    res.json({
      users: formattedUsers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Bonus: Get single user details (for modal)
export const getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, role: 'user' }).select(
      'fullName phone email userStatus lastSeen createdAt'
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Total spent
    const totalSpent = await Wallet.aggregate([
      {
        $match: {
          userId: user._id,
          type: 'debit',
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    // Recent wallet transactions (last 10)
    const walletHistory = await Wallet.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('type amount description createdAt');

    res.json({
      user: {
        ...user.toObject(),
        totalSpent: totalSpent[0]?.total || 0,
      },
      walletHistory: walletHistory.map((tx) => ({
        type: tx.type === 'credit' ? 'Added Money' : tx.type === 'debit' ? 'Call Charge' : 'Other',
        amount: tx.type === 'credit' ? `+₹${tx.amount}` : `-₹${tx.amount}`,
        date: tx.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      })),
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { userStatus } = req.body;

    // 1️⃣ Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id"
      });
    }

    // 2️⃣ Validate status value
    const allowedStatuses = ["Active", "InActive", "Blocked"];
    if (!allowedStatuses.includes(userStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userStatus value"
      });
    }

    // 3️⃣ Update user status (only normal users)
    const user = await User.findOneAndUpdate(
      { _id: id, role: "user" },
      { userStatus },
      { new: true }
    ).select("_id fullName phone userStatus");

    // 4️⃣ Handle not found
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // 5️⃣ Success response
    res.status(200).json({
      success: true,
      message: "User status updated successfully",
      data: user
    });

  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


export const getUserKundaliReports = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      KundaliReport.find({ userId: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      KundaliReport.countDocuments({ userId: id })
    ]);

    res.status(200).json({
      success: true,
      data: reports.map((report) => ({
        _id: report._id,
        name: report.name,
        dob: report.dob,              // YYYY-MM-DD
        tob: report.tob,              // HH:mm
        place: report.place,
        coordinates: report.coordinates,
        generatedAt: report.generatedAt,
        expiresAt: report.expiresAt,
        createdAt: report.createdAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Get user kundali reports error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


export const getUserKundaliMatchings = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;

    const [matchings, total] = await Promise.all([
      KundaliMatching.find({ userId: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      KundaliMatching.countDocuments({ userId: id })
    ]);

    res.status(200).json({
      success: true,
      data: matchings.map((match) => ({
        _id: match._id,
        person1: {
          name: match.person1.name,
          dob: match.person1.dob,
          tob: match.person1.tob,
          place: match.person1.place
        },
        person2: {
          name: match.person2.name,
          dob: match.person2.dob,
          tob: match.person2.tob,
          place: match.person2.place
        },
        result: match.result,
        generatedAt: match.generatedAt,
        expiresAt: match.expiresAt,
        createdAt: match.createdAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Get user kundali matchings error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id"
      });
    }

    // 2️⃣ Pick only allowed fields
    const allowedUpdates = [
      "fullName",
      "email",
      "photo",
      "gender",
      "dateOfBirth",
      "timeOfBirth",
      "placeOfBirth",
      "isAccurate",
      "deviceToken"
    ];

    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // 3️⃣ Prevent empty update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update"
      });
    }

    // 4️⃣ Update user
    const user = await User.findOneAndUpdate(
      { _id: id, role: "user" },
      { $set: updates },
      { new: true, runValidators: true }
    ).select(
      "_id fullName phone email photo gender userStatus isVerified"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // 5️⃣ Success response
    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: user
    });

  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};







export const addFundsManually = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const adminId = req.user.id;
    const {
      userId,
      amount,
      currency = "INR",
      bonusAmount = 0,
      reason,
      reference,
    } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user or amount",
      });
    }

    const txId = generateTxId("MANUAL");

    /* ===================== WALLET ===================== */
    let wallet = await Wallet.findOne({ userId }).session(session);

    if (!wallet) {
      wallet = await Wallet.create(
        [
          {
            userId,
            balances: [
              {
                currency,
                available: 0,
                bonus: 0,
                locked: 0,
                pendingIncoming: 0,
              },
            ],
          },
        ],
        { session }
      );
      wallet = wallet[0];
    }

    const balance = wallet.balances.find((b) => b.currency === currency);
    if (!balance) {
      wallet.balances.push({
        currency,
        available: amount,
        bonus: bonusAmount,
        locked: 0,
        pendingIncoming: 0,
      });
    } else {
      balance.available += amount;
      balance.bonus += bonusAmount;
    }

    wallet.lastBalanceUpdate = new Date();
    await wallet.save({ session });

    /* ===================== TRANSACTION ===================== */
    await Transaction.create(
      [
        {
          txId,
          userId,
          entityType: "ADMIN",
          entityId: adminId,
          type: "CREDIT",
          category: "ADMIN_ADJUSTMENT",
          amount,
          currency,
          bonusAmount,
          status: "SUCCESS",
          description: reason,
          meta: {
            reference,
            creditedBy: adminId,
          },
        },
      ],
      { session }
    );

    /* ===================== LEDGER ===================== */
    await Ledger.create(
      [
        {
          userId,
          walletId: wallet._id,
          transactionId: txId,
          entryType: "credit",
          amount: amount + bonusAmount,
          beforeBalance:
            balance?.available - amount || 0,
          afterBalance:
            balance?.available || amount,
          description: reason,
        },
      ],
      { session }
    );

    /* ===================== WALLET AUDIT ===================== */
    await WalletAudit.create(
      [
        {
          userId,
          walletId: wallet._id,
          action: "MANUAL_ADJUSTMENT",
          txId,
          changes: {
            available: {
              before: balance?.available - amount || 0,
              after: balance?.available || amount,
            },
            bonus: {
              before: balance?.bonus - bonusAmount || 0,
              after: balance?.bonus || bonusAmount,
            },
          },
          performedBy: "ADMIN",
          performedById: adminId,
          note: reason,
          meta: { reference },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: "Funds added successfully",
      data: {
        txId,
        creditedAmount: amount,
        bonusAmount,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Add funds error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};





export const freezeWallet = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId, reason } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: "userId and reason are required",
      });
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ success: false, message: "Wallet not found" });
    }

    if (wallet.status === "SUSPENDED") {
      return res.status(400).json({
        success: false,
        message: "Wallet already frozen",
      });
    }

    const previousStatus = wallet.status;
    wallet.status = "SUSPENDED";
    await wallet.save();

    await WalletAudit.create({
      userId,
      walletId: wallet._id,
      action: "STATUS_CHANGE",
      txId: generateTxId("FREEZE"),
      performedBy: "ADMIN",
      performedById: adminId,
      note: reason,
      meta: {
        from: previousStatus,
        to: "SUSPENDED",
      },
    });

    return res.json({
      success: true,
      message: "Wallet frozen successfully",
    });
  } catch (error) {
    console.error("Freeze wallet error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


export const blockWallet = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId, reason } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: "userId and reason are required",
      });
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ success: false, message: "Wallet not found" });
    }

    if (wallet.status === "BLOCKED") {
      return res.status(400).json({
        success: false,
        message: "Wallet already blocked",
      });
    }

    const previousStatus = wallet.status;
    wallet.status = "BLOCKED";
    await wallet.save();

    await WalletAudit.create({
      userId,
      walletId: wallet._id,
      action: "BLOCK",
      txId: generateTxId("BLOCK"),
      performedBy: "ADMIN",
      performedById: adminId,
      note: reason,
      meta: {
        from: previousStatus,
        to: "BLOCKED",
      },
    });

    return res.json({
      success: true,
      message: "Wallet blocked successfully",
    });
  } catch (error) {
    console.error("Block wallet error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const unblockWallet = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId, reason } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: "userId and reason are required",
      });
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ success: false, message: "Wallet not found" });
    }

    if (!["BLOCKED", "SUSPENDED"].includes(wallet.status)) {
      return res.status(400).json({
        success: false,
        message: "Wallet is not blocked or frozen",
      });
    }

    const previousStatus = wallet.status;
    wallet.status = "ACTIVE";
    await wallet.save();

    await WalletAudit.create({
      userId,
      walletId: wallet._id,
      action: "UNBLOCK",
      txId: generateTxId("UNBLOCK"),
      performedBy: "ADMIN",
      performedById: adminId,
      note: reason,
      meta: {
        from: previousStatus,
        to: "ACTIVE",
      },
    });

    return res.json({
      success: true,
      message: "Wallet reactivated successfully",
    });
  } catch (error) {
    console.error("Unblock wallet error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

