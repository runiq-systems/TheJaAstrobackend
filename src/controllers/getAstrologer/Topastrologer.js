import { User } from "../../models/user.js";
import { Astrologer } from "../../models/astrologer.js";

export const getTopAstrologers = async (req, res) => {
    try {
        const result = await Astrologer.aggregate([
            {
                $match: {
                    astrologerApproved: true,
                    accountStatus: "approved",
                    rank: { $ne: null }
                }
            },
            {
                $sort: { rank: 1 }
            },
            {
                $limit: 10
            },
            {
                $project: {
                    _id: 1,
                    userId: 1,
                    languages: 1,
                    ratepermin: 1,
                    rank: 1,
                    photo: 1
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user",
                    pipeline: [
                        {
                            $project: {
                                _id: 1,
                                fullName: 1
                            }
                        }
                    ]
                }
            },
            {
                $unwind: "$user"
            }
        ]);

        return res.status(200).json({
            ok: true,
            data: result,
        });

    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: err.message,
        });
    }
};



export const toggleOnlineStatus = async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                ok: false,
                message: "User ID is required"
            });
        }

        // Fetch current user
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: "User not found"
            });
        }

        // Toggle logic
        const newStatus = !user.isOnline; // TRUE → FALSE, FALSE → TRUE

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                isOnline: newStatus,
                status: newStatus ? "Online" : "offline",
                lastSeen: new Date(),
            },
            { new: true }
        );

        return res.status(200).json({
            ok: true,
            message: newStatus ? "User is Online" : "User is Offline",
            user: updatedUser
        });

    } catch (error) {
        console.error("Toggle online/offline error:", error);
        return res.status(500).json({
            ok: false,
            message: "Server Error"
        });
    }
};
