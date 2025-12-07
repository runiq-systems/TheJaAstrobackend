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
