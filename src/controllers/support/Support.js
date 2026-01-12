import mongoose from "mongoose";
import { Support } from "../../models/Suppport/Support.js";
/* ----------------------------------------
   Utility Helpers
---------------------------------------- */

const buildSearchQuery = (search) => {
    if (!search) return {};
    return {
        $or: [
            { issue: { $regex: search, $options: "i" } },
            { comment: { $regex: search, $options: "i" } }
        ]
    };
};

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
            return res.status(400).json({ message: "userId and issue are required" });
        }

        const support = await Support.create({
            userId,
            issue,
            comment,
            priority
        })
        .populate("userId", "fullName phone role")

        res.status(201).json({
            success: true,
            data: support
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
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

    const query = {
      isDeleted: false,
      ...buildSearchQuery(search),
      ...buildDateQuery(fromDate, toDate)
    };

    if (status) query.status = status;
    if (priority) query.priority = priority;

    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      Support.find(query)
        .populate("userId", "name email phone")   // ← changed here
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Support.countDocuments(query)
    ]);

    res.json({
      success: true,
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (error) {
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
