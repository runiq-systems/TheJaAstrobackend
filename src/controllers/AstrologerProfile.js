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

        const astrologer = await ensureAstrologer(userId);
        
        // Track updates
        let updatesMade = false;
        const updatedFields = [];
        const userUpdates = {};
        const astrologerUpdates = {};

        // === CHECK FOR FIRST-TIME SUBMISSION ===
        const user = await User.findById(userId);
        const isInitialSubmission = !user?.fullName || !user?.gender;

        // === VALIDATION FOR FIRST-TIME ===
        if (isInitialSubmission) {
            // For first-time, require fullName and gender
            if (!fullName || !gender) {
                return res.status(400).json({ 
                    success: false,
                    message: "For initial profile setup, full name and gender are required" 
                });
            }
        }

        // === PARTIAL UPDATES FOR USER DOCUMENT ===
        if (fullName !== undefined && fullName !== null) {
            userUpdates.fullName = fullName;
            updatesMade = true;
            updatedFields.push('fullName');
        }
        
        if (gender !== undefined && gender !== null) {
            userUpdates.gender = gender;
            updatesMade = true;
            updatedFields.push('gender');
        }

        // === PARTIAL UPDATES FOR ASTROLOGER DOCUMENT ===
        if (specialization !== undefined && specialization !== null) {
            astrologerUpdates.specialization = specialization;
            updatesMade = true;
            updatedFields.push('specialization');
        }
        
        if (expertise !== undefined && expertise !== null) {
            astrologerUpdates.yearOfExpertise = expertise; // Note: field name difference
            updatesMade = true;
            updatedFields.push('expertise');
        }

        // === APPLY UPDATES ===
        if (Object.keys(userUpdates).length > 0) {
            await User.findByIdAndUpdate(userId, userUpdates, { new: true });
        }

        if (Object.keys(astrologerUpdates).length > 0) {
            Object.assign(astrologer, astrologerUpdates);
            await astrologer.save();
        }

        // === RESPONSE ===
        if (updatesMade) {
            // Fetch updated astrologer with populated user data
            const updatedAstrologer = await ensureAstrologer(userId);
            
            return res.status(200).json({
                success: true,
                message: isInitialSubmission ? "Profile created successfully" : "Profile updated successfully",
                updatedFields: updatedFields,
                data: {
                    user: {
                        fullName: userUpdates.fullName || user?.fullName,
                        gender: userUpdates.gender || user?.gender
                    },
                    astrologer: updatedAstrologer
                }
            });
        } else {
            // No fields were provided for update
            return res.status(200).json({
                success: true,
                message: "No changes made",
                data: {
                    user: {
                        fullName: user?.fullName,
                        gender: user?.gender
                    },
                    astrologer: astrologer
                }
            });
        }

    } catch (err) {
        console.error("STEP 1 update error:", err);
        return res.status(500).json({ 
            success: false,
            message: "Server error",
            error: err.message 
        });
    }
};

/* ============================================================
   STEP 2 — EXPERIENCE + LANGUAGES + PHOTO (Cloudinary Upload)
============================================================ */
export const updateAstrologerStep2 = async (req, res) => {
    try {
        const userId = req.user._id;
        const { yearOfExperience, languages } = req.body;

        const astrologer = await ensureAstrologer(userId);

        // Track if any updates were made
        let updatesMade = false;
        const updatedFields = [];

        // === PARTIAL UPDATE LOGIC ===
        
        // Update yearOfExperience if provided
        if (yearOfExperience !== undefined && yearOfExperience !== null) {
            astrologer.yearOfExperience = yearOfExperience;
            updatesMade = true;
            updatedFields.push('yearOfExperience');
        }
        
        // Update languages if provided
        if (languages !== undefined && languages !== null) {
            // Handle both string and array input
            astrologer.languages = Array.isArray(languages) ? languages : [languages];
            updatesMade = true;
            updatedFields.push('languages');
        }

        // Handle profile photo upload if provided
        let cloudPhoto = null;
        if (req.file) {
            cloudPhoto = await uploadToCloudinary(req.file.buffer, "astrologers/profile");
            astrologer.photo = cloudPhoto.secure_url;
            updatesMade = true;
            updatedFields.push('photo');
        }

        // === VALIDATION FOR FIRST-TIME SUBMISSION ===
        // Check if this is initial submission (profile missing required fields)
        const isInitialSubmission = !astrologer.yearOfExperience || !astrologer.languages || astrologer.languages.length === 0;
        
        if (isInitialSubmission) {
            // For first-time submission, require both fields
            if (!yearOfExperience || !languages) {
                return res.status(400).json({ 
                    message: "For initial profile setup, both experience and languages are required" 
                });
            }
        }

        // === SAVE ONLY IF UPDATES WERE MADE ===
        if (updatesMade) {
            await astrologer.save();
            
            return res.status(200).json({
                success: true,
                message: isInitialSubmission ? "Profile created successfully" : "Profile updated successfully",
                updatedFields: updatedFields,
                astrologer,
            });
        } else {
            // No fields were provided for update
            return res.status(200).json({
                success: true,
                message: "No changes made",
                astrologer,
            });
        }

    } catch (err) {
        console.error("STEP 2 update error:", err);
        return res.status(500).json({ 
            success: false,
            message: "Server error",
            error: err.message 
        });
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
            bankDetails,        // ← optional for partial updates
        } = req.body;

        // === FIND ASTROLOGER ===
        const astrologer = await ensureAstrologer(userId);
        
        // Check if KYC already exists
        const hasExistingKyc = astrologer.kyc && Object.keys(astrologer.kyc).length > 0;
        
        // === VALIDATION LOGIC FOR PARTIAL UPDATES ===
        // For FIRST-TIME KYC submission: all fields required
        if (!hasExistingKyc) {
            if (!panNumber || !aadhaarNumber || !bankDetails) {
                return res.status(400).json({ 
                    message: "For initial KYC submission, PAN, Aadhaar & Bank details are required" 
                });
            }
        }
        
        // For UPDATES: fields are optional (partial updates allowed)
        // Only validate what's being provided

        // === PARSE bankDetails IF PROVIDED ===
        let parsedBankDetails = null;
        if (bankDetails) {
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
            
            // Validate bank fields ONLY if bankDetails is provided
            const { accountNumber, ifscCode, bankName, accountHolderName } = parsedBankDetails;
            if (!accountNumber || !ifscCode || !bankName || !accountHolderName) {
                return res.status(400).json({ 
                    message: "All bank fields (accountNumber, ifscCode, bankName, accountHolderName) are required when updating bank details" 
                });
            }
        }

        // === UPDATE KYC LOGIC ===
        // Initialize kyc if it doesn't exist
        if (!astrologer.kyc) {
            astrologer.kyc = {};
        }

        // Update only provided fields
        if (panNumber) {
            astrologer.kyc.panNumber = panNumber.trim();
        }
        
        if (aadhaarNumber) {
            // Validate Aadhaar length if being updated
            if (aadhaarNumber.trim().length !== 12) {
                return res.status(400).json({ 
                    message: "Aadhaar number must be 12 digits" 
                });
            }
            astrologer.kyc.aadhaarNumber = aadhaarNumber.trim();
        }

        // === HANDLE FILE UPLOADS (Only upload if provided) ===
        const files = req.files || {};

        const uploadImage = async (fileBuffer, existingUrl) => {
            // If new file provided, upload it
            if (fileBuffer) {
                const result = await uploadToCloudinary(fileBuffer, "astrologers/kyc");
                return result.secure_url;
            }
            // If no new file but this is initial KYC, require the image
            if (!hasExistingKyc && !existingUrl) {
                throw new Error(`Image required for initial KYC submission`);
            }
            // Otherwise keep existing URL
            return existingUrl;
        };

        try {
            // Upload only provided images, keep existing ones otherwise
            astrologer.kyc.panCardImage = await uploadImage(
                files.panCardImage?.[0]?.buffer, 
                astrologer.kyc.panCardImage
            );
            
            astrologer.kyc.aadhaarFrontImage = await uploadImage(
                files.aadhaarFrontImage?.[0]?.buffer, 
                astrologer.kyc.aadhaarFrontImage
            );
            
            astrologer.kyc.aadhaarBackImage = await uploadImage(
                files.aadhaarBackImage?.[0]?.buffer, 
                astrologer.kyc.aadhaarBackImage
            );
            
            astrologer.kyc.passbookImage = await uploadImage(
                files.passbookImage?.[0]?.buffer, 
                astrologer.kyc.passbookImage
            );
            
            astrologer.kyc.qualificationImage = await uploadImage(
                files.qualificationImage?.[0]?.buffer, 
                astrologer.kyc.qualificationImage
            );
        } catch (uploadError) {
            return res.status(400).json({ 
                message: uploadError.message 
            });
        }

        // Update bank details if provided
        if (parsedBankDetails) {
            const { accountNumber, ifscCode, bankName, accountHolderName } = parsedBankDetails;
            
            astrologer.kyc.bankDetails = {
                bankName: bankName.trim(),
                accountNumber: accountNumber.trim(),
                ifscCode: ifscCode.trim(),
                accountHolderName: accountHolderName.trim(),
            };

            // === UPDATE TOP-LEVEL bankDetails ARRAY ===
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
        }

        // Set KYC status to pending if any KYC field was updated
        const kycFieldsUpdated = panNumber || aadhaarNumber || bankDetails || 
                               Object.keys(files).length > 0;
        
        if (kycFieldsUpdated) {
            astrologer.kyc.kycVerified = false;
            astrologer.kyc.kycStatus = "pending";
            // Clear any previous rejection reason
            astrologer.kyc.rejectionReason = "";
        }

        astrologer.isProfilecomplet = true;
        astrologer.accountStatus = "pending";

        await astrologer.save();

        return res.status(200).json({
            success: true,
            message: hasExistingKyc ? "KYC updated successfully!" : "KYC submitted successfully!",
            note: hasExistingKyc ? "Awaiting admin re-verification." : "Awaiting admin approval.",
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

// Allowed fields that can be updated
const ALLOWED_UPDATE_FIELDS = [
    'fullName',
  'photo',
  'specialization',
  'yearOfExpertise',
  'yearOfExperience',
  'bio',
  'description',
  'ratepermin',
  'languages',
  'qualification'
];
/* ============================================================
   UPDATE ASTROLOGER PROFILE (General updates after registration)
============================================================ */
export const updateAstrologerProfile = async (req, res) => {
  try {
    const userId = req.user._id; // This is User ID from token

    // Filter out disallowed fields
    const updateData = {};
    Object.keys(req.body).forEach(key => {
      if (ALLOWED_UPDATE_FIELDS.includes(key)) {
        updateData[key] = req.body[key];
      }
    });

    // Handle photo upload if provided
    if (req.file) {
      const result = await uploadToCloudinary(req.file);
      updateData.photo = result.secure_url;
    }

    // If no valid fields to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update'
      });
    }
    

    // Validate specific fields if they exist in updateData
    if (updateData.bio && updateData.bio.length > 300) {
      return res.status(400).json({
        success: false,
        message: 'Bio cannot exceed 300 characters'
      });
    }

    if (updateData.description && updateData.description.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Description cannot exceed 2000 characters'
      });
    }

    // Add this validation for fullName
    if (updateData.fullName && updateData.fullName.trim().length < 2) {
    return res.status(400).json({
        success: false,
        message: 'Full name must be at least 2 characters long'
    });
    }

    if (updateData.ratepermin && (updateData.ratepermin < 1 || updateData.ratepermin > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Rate per minute must be between 1 and 100'
      });
    }

    // Handle languages array - make sure it's always an array
    if (updateData.languages !== undefined) {
      updateData.languages = Array.isArray(updateData.languages) 
        ? updateData.languages 
        : [updateData.languages];
    }

    if (updateData.specialization !== undefined) {
      updateData.specialization = Array.isArray(updateData.specialization)
        ? updateData.specialization
        : [updateData.specialization];
    }

    if (updateData.fullName) {
      await User.findByIdAndUpdate(
        userId,
        { $set: { fullName: updateData.fullName.trim() } },
        { new: true, runValidators: true }
      );
      
      delete updateData.fullName;
    }

    const updatedAstrologer = await Astrologer.findOneAndUpdate(
      { userId: userId }, 
      { $set: updateData },
      { 
        new: true, // Return the updated document
        runValidators: true, // Run schema validators
        select: '-bankDetails -kyc -__v -createdAt -updatedAt' // Exclude sensitive fields
      }
    );

    if (!updatedAstrologer) {
      return res.status(404).json({
        success: false,
        message: 'Astrologer profile not found'
      });
    }
    const updatedUser = await User.findById(userId).select('fullName');
    const responseData = updatedAstrologer.toObject ? updatedAstrologer.toObject() : updatedAstrologer;

    // Add fullName to response if it was updated
    if (updatedUser && updateData.fullName) {
    responseData.fullName = updatedUser.fullName;
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Update profile error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate field value entered'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};