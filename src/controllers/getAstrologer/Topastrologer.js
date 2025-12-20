import { User } from "../../models/user.js";
import { Astrologer } from "../../models/astrologer.js";

import {
    uploadOnCloudinary,
    getPublicIdFromUrl,
    deleteFromCloudinary,
} from "../../utils/cloudinary.js";

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
        const userId = req.user.id; // ✅ from auth middleware

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: "User not found",
            });
        }

        let newStatus;
        let newIsOnline;

        if (user.status === "Busy") {
            newStatus = "Online";
            newIsOnline = true;
        } else if (user.isOnline) {
            newStatus = "offline";
            newIsOnline = false;
        } else {
            newStatus = "Online";
            newIsOnline = true;
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                status: newStatus,
                isOnline: newIsOnline,
                lastSeen: new Date(),
            },
            { new: true }
        );

        return res.status(200).json({
            ok: true,
            message: `Status updated to ${newStatus}`,
            data: updatedUser,
        });
    } catch (error) {
        console.error("Toggle online/offline error:", error);
        return res.status(500).json({
            ok: false,
            message: "Server Error",
        });
    }
};


export const getMe = async (req, res) => {
    try {
        // authMiddleware must attach user to req
        const userId = req.user.id;

        const user = await User.findById(userId).select(
            "_id fullName phone email photo role status isOnline lastSeen"
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error("Get me error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};






/**
 * @desc    Get astrologer profile (self)
 * @route   GET /api/astrologer/profile
 * @access  Astrologer (protected)
 */
export const getAstrologerProfile = async (req, res) => {
    try {
        const userId = req.user._id;

        // Fetch astrologer profile
        const astrologer = await Astrologer.findOne({ userId })
            .populate("userId", "fullName phone email photo");

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer profile not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: astrologer,
        });
    } catch (error) {
        console.error("Get astrologer profile error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch profile",
        });
    }
};



/**
 * @desc    Update astrologer profile
 * @route   PUT /api/astrologer/profile
 * @access  Astrologer (protected)
 */

export const updateAstrologerProfile = async (req, res) => {
    try {
        const userId = req.user._id;

        const {
            fullName,
            bio,
            description,
            yearOfExperience,
            yearOfExpertise,
            ratepermin,
            languages,
            qualification,
            specialization,
        } = req.body;

        let photoUrl;

        // 1️⃣ Upload image to Cloudinary (if provided)
        if (req.file?.path) {
            const astrologer = await Astrologer.findOne({ userId });

            // Delete old photo if exists
            if (astrologer?.photo) {
                const oldPublicId = getPublicIdFromUrl(astrologer.photo);
                if (oldPublicId) {
                    await deleteFromCloudinary(oldPublicId);
                }
            }

            const uploadResult = await uploadOnCloudinary(
                req.file.path,
                "astrologers/profile"
            );

            photoUrl = uploadResult.url;
        }

        // 2️⃣ Update User basic info
        if (fullName || photoUrl) {
            await User.findByIdAndUpdate(userId, {
                ...(fullName && { fullName }),
                ...(photoUrl && { photo: photoUrl }),
            });
        }

        // 3️⃣ Prepare astrologer update payload
        const updateData = {
            bio,
            description,
            qualification,
            ...(photoUrl && { photo: photoUrl }),
            yearOfExperience,
            yearOfExpertise,
            ratepermin: ratepermin ? Number(ratepermin) : undefined,
            languages: languages
                ? languages.split(",").map(l => l.trim())
                : undefined,
            specialization: Array.isArray(specialization)
                ? specialization
                : undefined,
            isProfilecomplet: true,
        };

        // Remove undefined fields
        Object.keys(updateData).forEach(
            key => updateData[key] === undefined && delete updateData[key]
        );

        const astrologer = await Astrologer.findOneAndUpdate(
            { userId },
            { $set: updateData },
            { new: true }
        ).populate("userId", "fullName phone email photo");

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer profile not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            data: astrologer,
        });
    } catch (error) {
        console.error("Update astrologer profile error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to update profile",
        });
    }
};
