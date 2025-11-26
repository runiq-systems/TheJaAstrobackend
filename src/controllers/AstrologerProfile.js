import mongoose from "mongoose";
import { User } from "../models/user.js";
import { Astrologer } from "../models/astrologer.js";
import { uploadToCloudinary } from "../utils/uplodeimage.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

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
            bankDetails,        // ← this will be parsed below
        } = req.body;

        // === VALIDATE REQUIRED FIELDS ===
        if (!panNumber || !aadhaarNumber || !bankDetails) {
            return res.status(400).json({ message: "PAN, Aadhaar & Bank details are required" });
        }

        // === PARSE bankDetails SAFELY (it may come as string from FormData) ===
        let parsedBankDetails;
        try {
            // If frontend sent JSON.stringify(), it comes as string
            if (typeof bankDetails === "string") {
                parsedBankDetails = JSON.parse(bankDetails);
            } else {
                parsedBankDetails = bankDetails; // already an object
            }
        } catch (parseErr) {
            return res.status(400).json({ message: "Invalid bankDetails format" });
        }

        // Validate required bank fields
        const { accountNumber, ifscCode, bankName, accountHolderName } = parsedBankDetails;
        if (!accountNumber || !ifscCode || !bankName || !accountHolderName) {
            return res.status(400).json({ message: "All bank fields are required" });
        }

        const astrologer = await ensureAstrologer(userId);

        // === HANDLE FILE UPLOADS ===
        const files = req.files || {};

        const uploadImage = async (fileBuffer) => {
            if (!fileBuffer) return null;
            const result = await uploadToCloudinary(fileBuffer, "astrologers/kyc");
            return result.secure_url;
        };

        const panCardImage = await uploadImage(files.panCardImage?.[0]?.buffer);
        const aadhaarFrontImage = await uploadImage(files.aadhaarFrontImage?.[0]?.buffer);
        const aadhaarBackImage = await uploadImage(files.aadhaarBackImage?.[0]?.buffer);
        const passbookImage = await uploadImage(files.passbookImage?.[0]?.buffer);
        const qualificationImage = await uploadImage(files.qualificationImage?.[0]?.buffer);

        // === UPDATE KYC SUB-DOCUMENT ===
        astrologer.kyc = {
            panNumber: panNumber.trim(),
            aadhaarNumber: aadhaarNumber.trim(),
            kycVerified: false,
            kycStatus: "pending",
            bankDetails: {
                bankName: bankName.trim(),
                accountNumber: accountNumber.trim(),
                ifscCode: ifscCode.trim(),
                accountHolderName: accountHolderName.trim(),
            },
            panCardImage,
            aadhaarFrontImage,
            aadhaarBackImage,
            passbookImage,
            qualificationImage,
        };

        // === UPDATE TOP-LEVEL bankDetails ARRAY (as per your schema) ===
        // Remove old bank entry if exists, then push new one
        astrologer.bankDetails = astrologer.bankDetails.filter(
            (b) => b.accountNumber !== accountNumber.trim()
        );

        astrologer.bankDetails.push({
            bankName: bankName.trim(),
            accountNumber: accountNumber.trim(),
            ifscCode: ifscCode.trim(),
            accountHolderName: accountHolderName.trim(),
        });

        astrologer.isProfilecomplet = true;
        astrologer.accountStatus = "pending"; // or keep existing logic

        await astrologer.save();

        return res.status(200).json({
            success: true,
            message: "KYC submitted successfully! Awaiting admin approval.",
            astrologer,
        });
    } catch (err) {
        console.error("STEP 3 upload error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message,
        });
    }
};




/* ============================================================
   GET ASTROLOGER PROFILE — ALL 3 STEPS DATA
============================================================ */
export const getAstrologerProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const astrologer = await Astrologer.findOne({ userId })
      .select('-__v -createdAt -updatedAt')
      .lean();

    if (!astrologer) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Return structured data for frontend
    res.status(200).json({
      success: true,
      data: {
        // Step 1
        fullName: req.user.fullName || "",
        gender: req.user.gender || "",
        specialization: astrologer.specialization || [],
        yearOfExpertise: astrologer.yearOfExpertise || "",

        // Step 2
        photo: astrologer.photo || "",
        yearOfExperience: astrologer.yearOfExperience || "",
        languages: astrologer.languages || [],

        // Step 3 - KYC
        kyc: astrologer.kyc
          ? {
              panNumber: astrologer.kyc.panNumber || "",
              aadhaarNumber: astrologer.kyc.aadhaarNumber || "",
              panCardImage: astrologer.kyc.panCardImage || "",
              aadhaarFrontImage: astrologer.kyc.aadhaarFrontImage || "",
              aadhaarBackImage: astrologer.kyc.aadhaarBackImage || "",
              passbookImage: astrologer.kyc.passbookImage || "",
              qualificationImage: astrologer.kyc.qualificationImage || "",
              bankDetails: astrologer.kyc.bankDetails || null,
              kycStatus: astrologer.kyc.kycStatus || "pending",
              rejectionReason: astrologer.kyc.rejectionReason || "",
            }
          : null,

        // Extra
        isProfileComplete: astrologer.isProfilecomplet || false,
        accountStatus: astrologer.accountStatus || "pending",
      },
    });
  } catch (err) {
    console.error("Get Profile Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   GET STEP 1 DATA ONLY
============================================================ */
export const getStep1Data = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('fullName gender').lean();
    const astrologer = await Astrologer.findOne({ userId }).select('specialization yearOfExpertise').lean();

    res.json({
      success: true,
      data: {
        fullName: user?.fullName || "",
        gender: user?.gender || "",
        specialization: astrologer?.specialization || [],
        yearOfExpertise: astrologer?.yearOfExpertise || "",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   GET STEP 2 DATA ONLY
============================================================ */
export const getStep2Data = async (req, res) => {
  try {
    const userId = req.user._id;
    const astrologer = await Astrologer.findOne({ userId })
      .select('photo yearOfExperience languages')
      .lean();

    res.json({
      success: true,
      data: {
        photo: astrologer?.photo || "",
        yearOfExperience: astrologer?.yearOfExperience || "",
        languages: astrologer?.languages || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   GET STEP 3 (KYC) DATA ONLY
============================================================ */
export const getStep3Data = async (req, res) => {
  try {
    const userId = req.user._id;
    const astrologer = await Astrologer.findOne({ userId }).select('kyc isProfilecomplet accountStatus').lean();

    if (!astrologer?.kyc) {
      return res.json({
        success: true,
        data: { kyc: null, isProfileComplete: false, accountStatus: "pending" },
      });
    }

    res.json({
      success: true,
      data: {
        kyc: {
          panNumber: astrologer.kyc.panNumber || "",
          aadhaarNumber: astrologer.kyc.aadhaarNumber || "",
          panCardImage: astrologer.kyc.panCardImage || "",
          aadhaarFrontImage: astrologer.kyc.aadhaarFrontImage || "",
          aadhaarBackImage: astrologer.kyc.aadhaarBackImage || "",
          passbookImage: astrologer.kyc.passbookImage || "",
          qualificationImage: astrologer.kyc.qualificationImage || "",
          bankDetails: astrologer.kyc.bankDetails || null,
          kycStatus: astrologer.kyc.kycStatus || "pending",
          rejectionReason: astrologer.kyc.rejectionReason || "",
        },
        isProfileComplete: astrologer.isProfilecomplet || false,
        accountStatus: astrologer.accountStatus || "pending",
      },
    });
  } catch (err) {
    console.error("Get Step 3 Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getAstrologersOnlineStatus = asyncHandler(async (req, res) => {
  try {
    const astrologers = await User.find({
      role: 'astrologer',
      userStatus: 'Active',
      isSuspend: false
    }).select('_id fullName isOnline lastSeen');

    const onlineStatus = {};
    astrologers.forEach(astrologer => {
      // Check if astrologer was active in the last 5 minutes
      const isOnline = astrologer.isOnline && 
        astrologer.lastSeen && 
        (Date.now() - new Date(astrologer.lastSeen).getTime()) < 5 * 60 * 1000;
      
      onlineStatus[astrologer._id] = isOnline;
    });

    return res.status(200).json(
      new ApiResponse(200, onlineStatus, "Online status retrieved successfully")
    );
  } catch (error) {
    throw new ApiError(500, "Failed to fetch online status");
  }
});