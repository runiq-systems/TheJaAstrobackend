import { CallSession } from "../../models/calllogs/callSession.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import logger from "../../utils/logger.js";

export const getUserHistory = async (req, res) => {
  try {
    const userId = req.user._id; // authenticated user
    const { type = 'all', page = 1, limit = 20 } = req.query;

    const skip = (page - 1) * limit;
    const limitNum = parseInt(limit);

    let callSessions = [];
    let chatSessions = [];

    // Common population for astrologer details
    const astrologerPopulate = {
      path: 'astrologerId',
      select: 'fullName avatar phone astrologerProfile',
    };

    // Fetch Call Sessions
    if (type === 'all' || type === 'call') {
      callSessions = await CallSession.find({ userId, status: 'COMPLETED' })
        .populate(astrologerPopulate)
        .sort({ endedAt: -1, connectedAt: -1 })
        .skip(type === 'call' ? skip : 0)
        .limit(type === 'call' ? limitNum : limitNum * 2) // fetch more if combining
        .lean();
    }

    // Fetch Chat Sessions
    if (type === 'all' || type === 'chat') {
      const chatSkip = type === 'chat' ? skip : 0;
      chatSessions = await ChatSession.find({ userId, status: 'COMPLETED' })
        .populate(astrologerPopulate)
        .sort({ endedAt: -1, startedAt: -1 })
        .skip(chatSkip)
        .limit(type === 'chat' ? limitNum : limitNum * 2)
        .lean();
    }

    // Combine both
    const combined = [
      ...callSessions.map(s => ({
        _id: s._id,
        type: 'call',
        sessionId: s.sessionId,
        astrologer: {
          _id: s.astrologerId._id,
          fullName: s.astrologerId.fullName || 'Astrologer',
          avatar: s.astrologerId.astrologerProfile?.photo || s.astrologerId.avatar,
          phone: s.astrologerId.phone,
          profile: {
            photo: s.astrologerId.astrologerProfile?.photo || null,
            specialization: s.astrologerId.astrologerProfile?.specialization || [],
            languages: s.astrologerId.astrologerProfile?.languages || [],
            yearOfExperience: s.astrologerId.astrologerProfile?.yearOfExperience || 0,
            ratepermin: s.ratePerMinute,
          },
        },
        duration: s.totalDuration || s.billedDuration || 0,
        cost: s.totalCost || 0,
        startedAt: s.connectedAt || s.startedAt || s.requestedAt,
        endedAt: s.endedAt || s.updatedAt,
        callType: s.callType,
        status: s.status,
        createdAt: s.createdAt,
      })),
      ...chatSessions.map(s => ({
        _id: s._id,
        type: 'chat',
        sessionId: s.sessionId,
        astrologer: {
          _id: s.astrologerId._id,
          fullName: s.astrologerId.fullName || 'Astrologer',
          avatar: s.astrologerId.astrologerProfile?.photo || s.astrologerId.avatar,
          phone: s.astrologerId.phone,
          profile: {
            photo: s.astrologerId.astrologerProfile?.photo || null,
            specialization: s.astrologerId.astrologerProfile?.specialization || [],
            languages: s.astrologerId.astrologerProfile?.languages || [],
            yearOfExperience: s.astrologerId.astrologerProfile?.yearOfExperience || 0,
            ratepermin: s.ratePerMinute,
          },
        },
        duration: s.totalDuration || s.billedDuration || 0,
        messageCount: s.messageCount || null, // if you track messages
        cost: s.totalCost || 0,
        startedAt: s.startedAt || s.acceptedAt,
        endedAt: s.endedAt || s.lastActivityAt || s.updatedAt,
        status: s.status,
        createdAt: s.createdAt,
      })),
    ];

    // Sort combined by endedAt (latest first)
    combined.sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));

    // Apply pagination if type='all'
    const paginated = type === 'all'
      ? combined.slice(skip, skip + limitNum)
      : combined;

    const total = type === 'all' ? combined.length : paginated.length;

    res.status(200).json({
      success: true,
      data: paginated,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        hasMore: total > skip + limitNum,
      },
    });
  } catch (error) {
    logger.error('User history fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history',
      error: error.message,
    });
  }
};