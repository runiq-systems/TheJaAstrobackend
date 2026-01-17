import mongoose from "mongoose";
import { Support } from "../../models/Suppport/Support.js";

const buildDateQuery = (fromDate, toDate) => {
    if (!fromDate && !toDate) return {};

    const dateQuery = {};
    if (fromDate) dateQuery.$gte = new Date(fromDate);
    if (toDate) dateQuery.$lte = new Date(toDate);

    return { createdAt: dateQuery };
};

/* ----------------------------------------
   Create Support Ticket
---------------------------------------- */
export const createSupport = async (req, res) => {
  try {
    const { userId, issue, comment, priority } = req.body;

    if (!userId || !issue) {
      return res.status(400).json({ 
        success: false,
        message: "userId and issue are required" 
      });
    }

    // 1. Create the document
    const newTicket = await Support.create({
      userId,
      issue,
      comment: comment || '',
      priority: priority || 'medium'
    });

    // 2. Fetch it again with populated user
    const populatedTicket = await Support.findById(newTicket._id)
      .populate("userId", "fullName phone role");

    res.status(201).json({
      success: true,
      data: populatedTicket
    });
  } catch (error) {
    console.error("Create support error:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to create support ticket",
      error: error.message 
    });
  }
};

/* ----------------------------------------
   Get Support by ID
---------------------------------------- */
export const getSupportById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid support ID" });
        }

        const support = await Support.findOne({ _id: id, isDeleted: false })
            .populate("userId", "name email");

        if (!support) {
            return res.status(404).json({ message: "Support ticket not found" });
        }

        res.json({ success: true, data: support });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/* ----------------------------------------
   Update Support
---------------------------------------- */
export const updateSupport = async (req, res) => {
    try {
        const { id } = req.params;

        const updated = await Support.findOneAndUpdate(
            { _id: id, isDeleted: false },
            req.body,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Support ticket not found" });
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/* ----------------------------------------
   Soft Delete Support
---------------------------------------- */
export const deleteSupport = async (req, res) => {
    try {
        const { id } = req.params;

        const deleted = await Support.findOneAndUpdate(
            { _id: id, isDeleted: false },
            { isDeleted: true },
            { new: true }
        );

        if (!deleted) {
            return res.status(404).json({ message: "Support ticket not found" });
        }

        res.json({ success: true, message: "Support ticket deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/* ----------------------------------------
   Get All Supports (Pagination + Search + Filter + Date Range)
---------------------------------------- */
export const getAllSupports = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      priority,
      fromDate,
      toDate
    } = req.query;

    const matchStage = {
      isDeleted: false
    };

    // Date range
    if (fromDate || toDate) {
      matchStage.createdAt = buildDateQuery(fromDate, toDate).createdAt;
    }

    // Status & Priority (direct fields)
    if (status) matchStage.status = status;
    if (priority) matchStage.priority = priority;

    const pipeline = [
      { $match: matchStage },

      // Join with User collection
      {
        $lookup: {
          from: "users",               // ← your User collection name (usually lowercase plural)
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Search stage (now we can search inside user fields)
      ...(search
        ? [{
            $match: {
              $or: [
                { issue: { $regex: search, $options: "i" } },
                { comment: { $regex: search, $options: "i" } },
                { "user.fullName": { $regex: search, $options: "i" } },
                { "user.email": { $regex: search, $options: "i" } },
                { "user.phone": { $regex: search, $options: "i" } } // optional
              ]
            }
          }]
        : []),

      // Sort & Pagination
      { $sort: { createdAt: -1 } },
      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) },

      // Project only needed fields (clean output)
      {
        $project: {
          issue: 1,
          comment: 1,
          status: 1,
          priority: 1,
          isDeleted: 1,
          createdAt: 1,
          updatedAt: 1,
          userId: {
            _id: "$user._id",
            fullName: "$user.fullName",
            email: "$user.email",
            phone: "$user.phone",
            role: "$user.role"
          }
        }
      }
    ];

    const [data, totalResult] = await Promise.all([
      Support.aggregate([...pipeline]),
      Support.aggregate([
        ...pipeline.slice(0, pipeline.findIndex(s => s.$skip)), // up to before skip/limit
        { $count: "total" }
      ])
    ]);

    const total = totalResult[0]?.total || 0;

    res.json({
      success: true,
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (error) {
    console.error("Error in getAllSupports:", error);
    res.status(500).json({ message: error.message });
  }
};
/* ----------------------------------------
   Get All Supports of Particular User
---------------------------------------- */
export const getSupportsByUser = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid user ID" });
        }

        const supports = await Support.find({
            userId,
            isDeleted: false
        }).sort({ createdAt: -1 });

        res.json({
            success: true,
            count: supports.length,
            data: supports
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
