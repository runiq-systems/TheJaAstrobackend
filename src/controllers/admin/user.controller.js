import { startOfDay, subDays } from 'date-fns';
import { User } from '../../models/user.js';
import { Transaction, Wallet } from '../../models/Wallet/AstroWallet.js';

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