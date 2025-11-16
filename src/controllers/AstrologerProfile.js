import mongoose from "mongoose";
import { User } from "../models/user.js";
import { Astrologer } from "../models/astrologer.js";
import { uploadToCloudinary } from "../utils/uplodeimage.js";

/**
 * Ensure astrologer exists
 */
const ensureAstrologer = async (userId) => {
    let profile = await Astrologer.findOne({ userId });
    if (!profile) profile = await Astrologer.create({ userId });
    return profile;
};


/* ============================================================
   STEP 1 — BASIC DETAILS
============================================================ */
export const updateAstrologerStep1 = async (req, res) => {
    try {
        const userId = req.user._id;
        const { fullName, gender, specialization, expertise } = req.body;

        if (!fullName || !gender) {
            return res.status(400).json({ message: "Full name & gender required" });
        }

        await User.findByIdAndUpdate(userId, { fullName, gender });

        const astrologer = await ensureAstrologer(userId);

        astrologer.specialization = specialization || astrologer.specialization;
        astrologer.yearOfExpertise = expertise || astrologer.yearOfExpertise;

        await astrologer.save();

        res.json({
            message: "Step 1 completed successfully",
            astrologer,
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};


/* ============================================================
   STEP 2 — EXPERIENCE + LANGUAGES + PHOTO (Cloudinary Upload)
============================================================ */
export const updateAstrologerStep2 = async (req, res) => {
    try {
        const userId = req.user._id;
        const { yearOfExperience, languages } = req.body;

        if (!yearOfExperience || !languages) {
            return res.status(400).json({ message: "Experience & languages required" });
        }

        const astrologer = await ensureAstrologer(userId);

        let cloudPhoto = null;

        // Single profile image upload
        if (req.file) {
            cloudPhoto = await uploadToCloudinary(req.file.buffer, "astrologers/profile");
        }

        astrologer.yearOfExperience = yearOfExperience;
        astrologer.languages = Array.isArray(languages) ? languages : [languages];
        if (cloudPhoto) astrologer.photo = cloudPhoto.secure_url;

        await astrologer.save();

        res.json({
            message: "Step 2 completed successfully",
            astrologer,
        });

    } catch (err) {
        console.error("STEP 2 upload error:", err);
        res.status(500).json({ message: "Server error" });
    }
};


/* ============================================================
   STEP 3 — FULL KYC (Cloudinary Uploads)
============================================================ */
export const updateAstrologerStep3 = async (req, res) => {
    try {
        const userId = req.user._id;

        const {
            panNumber,
            aadhaarNumber,
            bankDetails,
            qualificationImage,
        } = req.body;

        if (!panNumber || !aadhaarNumber || !bankDetails) {
            return res.status(400).json({ message: "Incomplete KYC details" });
        }

        const astrologer = await ensureAstrologer(userId);

        // Process multiple uploaded images
        const files = req.files || {};

        const panCardImg = files.panCardImage?.[0]?.buffer;
        const adFrontImg = files.aadhaarFrontImage?.[0]?.buffer;
        const adBackImg = files.aadhaarBackImage?.[0]?.buffer;
        const passbookImg = files.passbookImage?.[0]?.buffer;
        const qualImg = files.qualificationImage?.[0]?.buffer;

        // Upload to Cloudinary
        const uploaded = {};

        if (panCardImg)
            uploaded.panCardImage = await uploadToCloudinary(panCardImg, "astrologers/kyc");

        if (adFrontImg)
            uploaded.aadhaarFrontImage = await uploadToCloudinary(adFrontImg, "astrologers/kyc");

        if (adBackImg)
            uploaded.aadhaarBackImage = await uploadToCloudinary(adBackImg, "astrologers/kyc");

        if (passbookImg)
            uploaded.passbookImage = await uploadToCloudinary(passbookImg, "astrologers/kyc");

        if (qualImg)
            uploaded.qualificationImage = await uploadToCloudinary(qualImg, "astrologers/kyc");

        astrologer.kyc = {
            panNumber,
            aadhaarNumber,
            kycVerified: false,
            kycStatus: "pending",
            bankDetails,
            panCardImage: uploaded.panCardImage?.secure_url,
            aadhaarFrontImage: uploaded.aadhaarFrontImage?.secure_url,
            aadhaarBackImage: uploaded.aadhaarBackImage?.secure_url,
            passbookImage: uploaded.passbookImage?.secure_url,
            qualificationImage: uploaded.qualificationImage?.secure_url,
        };

        astrologer.bankDetails = [bankDetails];
        astrologer.isProfilecomplet = true;

        await astrologer.save();

        res.json({
            message: "Step 3 (KYC) completed successfully",
            astrologer,
        });

    } catch (err) {
        console.error("STEP 3 upload error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
