import { Astrologer } from "../../models/astrologer.js";
import { CallSession } from "../../models/calllogs/callSession.js";
import { ChatSession } from "../../models/chatapp/chatSession.js";
import logger from "../../utils/logger.js";

export const getUserHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { type = "all", page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    let callSessions = [];
    let chatSessions = [];

    // Step 1: Fetch sessions and populate astrologerId (User)
    const astrologerUserPopulate = {
      path: "astrologerId",
      select: "fullName phone avatar isOnline status lastSeen", // all useful User fields
    };

    if (type === "all" || type === "call") {
      callSessions = await CallSession.find({
        userId,
        status: "COMPLETED",
      })
        .populate(astrologerUserPopulate)
        .sort({ endedAt: -1 })
        .skip(type === "call" ? skip : 0)
        .limit(type === "call" ? limitNum : limitNum * 2)
        .lean();
    }

    if (type === "all" || type === "chat") {
      const chatSkip = type === "chat" ? skip : 0;
      chatSessions = await ChatSession.find({
        userId,
        status: "COMPLETED",
      })
        .populate(astrologerUserPopulate)
        .sort({ endedAt: -1 })
        .skip(chatSkip)
        .limit(type === "chat" ? limitNum : limitNum * 2)
        .lean();
    }

    // Step 2: Extract all unique astrologer User IDs
    const astrologerUserIds = [
      ...new Set(
        [
          ...callSessions.map(s => s.astrologerId?._id?.toString()),
          ...chatSessions.map(s => s.astrologerId?._id?.toString()),
        ].filter(Boolean)
      ),
    ];

    // Step 3: Fetch FULL Astrologer documents (all fields)
    const astrologerDocs = await Astrologer.find({
      userId: { $in: astrologerUserIds },
    }).lean();

    // Map: astrologer User ID → full Astrologer document
    const astrologerMap = {};
    astrologerDocs.forEach(doc => {
      astrologerMap[doc.userId.toString()] = doc;
    });

    // Step 4: Combine and enrich with everything
    const combined = [
      ...callSessions.map(s => {
        const user = s.astrologerId || {};
        const userIdStr = user._id?.toString();
        const astro = userIdStr ? astrologerMap[userIdStr] : null;

        return {
          _id: s._id.toString(),
          type: "call",
          sessionId: s.sessionId,
          callType: s.callType || "AUDIO",

          // Full Astrologer Info
          astrologer: {
            _id: userIdStr,
            fullName: user.fullName || "Astrologer",
            phone: user.phone || "",
            avatar: user.avatar || astro?.photo || null,
            isOnline: user.isOnline || false,
            status: user.status || "offline",
            lastSeen: user.lastSeen,

            // Everything from Astrologer collection
            photo: astro?.photo || null,
            specialization: astro?.specialization || [],
            yearOfExpertise: astro?.yearOfExpertise || null,
            yearOfExperience: astro?.yearOfExperience || null,
            bio: astro?.bio || null,
            description: astro?.description || null,
            ratepermin: astro?.ratepermin ?? s.ratePerMinute ?? 5,
            rank: astro?.rank || null,
            languages: astro?.languages || ["Hindi"],
            qualification: astro?.qualification || null,
            astrologerApproved: astro?.astrologerApproved || false,
            accountStatus: astro?.accountStatus || "pending",
            isProfilecomplet: astro?.isProfilecomplet || false,
          },

          duration: s.totalDuration || s.billedDuration || 0,
          billedDuration: s.billedDuration || 0,
          totalCost: s.totalCost || 0,
          startedAt: s.connectedAt || s.acceptedAt || s.requestedAt,
          endedAt: s.endedAt || s.updatedAt,
          createdAt: s.createdAt,
        };
      }),

      ...chatSessions.map(s => {
        const user = s.astrologerId || {};
        const userIdStr = user._id?.toString();
        const astro = userIdStr ? astrologerMap[userIdStr] : null;

        return {
          _id: s._id.toString(),
          type: "chat",
          sessionId: s.sessionId,

          astrologer: {
            _id: userIdStr,
            fullName: user.fullName || "Astrologer",
            phone: user.phone || "",
            avatar: user.avatar || astro?.photo || null,
            isOnline: user.isOnline || false,
            status: user.status || "offline",
            lastSeen: user.lastSeen,

            // Full Astrologer data
            photo: astro?.photo || null,
            specialization: astro?.specialization || [],
            yearOfExpertise: astro?.yearOfExpertise || null,
            yearOfExperience: astro?.yearOfExperience || null,
            bio: astro?.bio || null,
            description: astro?.description || null,
            ratepermin: astro?.ratepermin ?? s.ratePerMinute ?? 5,
            rank: astro?.rank || null,
            languages: astro?.languages || ["Hindi"],
            qualification: astro?.qualification || null,
            astrologerApproved: astro?.astrologerApproved || false,
            accountStatus: astro?.accountStatus || "pending",
            isProfilecomplet: astro?.isProfilecomplet || false,
          },

          duration: s.totalDuration || s.billedDuration || 0,
          billedDuration: s.billedDuration || 0,
          totalCost: s.totalCost || 0,
          startedAt: s.startedAt || s.acceptedAt || s.requestedAt,
          endedAt: s.endedAt || s.lastActivityAt || s.updatedAt,
          createdAt: s.createdAt,
        };
      }),
    ];

    // Sort by latest first
    combined.sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));

    // Pagination
    const paginated = type === "all" ? combined.slice(skip, skip + limitNum) : combined;
    const total = type === "all" ? combined.length : paginated.length;

    return res.status(200).json({
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
    logger.error("User history fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch history",
      error: error.message,
    });
  }
};