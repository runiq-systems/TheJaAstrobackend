import logger from "../../utils/logger.js";
import { User } from "../../models/user.js";
import { generateOtp, sendOtpMSG91 } from "../../utils/generateOtp.js";
import { Astrologer } from "../../models/astrologer.js";
import { uploadToCloudinary } from "../../utils/uplodeimage.js";
import mongoose from "mongoose";


export async function registerController(req, res) {
  try {
    const { phone, role } = req.body;

    if (!phone) {
      logger.warn("Phone number missing in request");
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      logger.warn(`Invalid phone format: ${phone}`);
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format.",
      });
    }

    const allowedRoles = ["user", "astrologer"];
    let finalRole = "user"; // default

    if (role) {
      if (!allowedRoles.includes(role)) {
        logger.warn(`Invalid role attempted: ${role}`);
        return res.status(400).json({
          success: false,
          message: "Invalid role. Allowed: User, Astrologer",
        });
      }
      finalRole = role;
    }

    let currentUser = await User.findOne({ phone });

    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (currentUser) {
      currentUser.otp = otp;
      currentUser.otpExpires = otpExpires;
      await currentUser.save();

      logger.info(`OTP resent to existing user: ${phone}`);
    } else {
      currentUser = await User.create({
        phone,
        role: finalRole,
        otp: otp,
        otpExpires,
        isVerified: true,
      });
      await currentUser.save();

      logger.info(`New user registered with role: ${finalRole}`);

      if (finalRole === "astrologer") {
        const alreadyAstrologer = await Astrologer.findOne({
          userId: currentUser._id,
        });

        if (!alreadyAstrologer) {
          await Astrologer.create({
            userId: currentUser._id,
            // All other fields remain empty initially
          });
          logger.info(
            `Astrologer profile created for user: ${currentUser._id}`
          );
        }
      }
    }


    const otpSent = await sendOtpMSG91(phone, otp);

    if (!otpSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP. Try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully.",
      data: {
        phone: currentUser.phone,
        role: currentUser.role,
        userId: currentUser._id,
        otpExpires: currentUser.otpExpires,
      },
    });
  } catch (error) {
    logger.error(`Error in registerController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}


export async function adminregisterController(req, res) {
  try {
    const { phone, role } = req.body;

    if (!phone) {
      logger.warn("Phone number missing in request");
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      logger.warn(`Invalid phone format: ${phone}`);
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format.",
      });
    }

    const allowedRoles = ["admin"];
    let finalRole = "admin"; // default

    if (role) {
      if (!allowedRoles.includes(role)) {
        logger.warn(`Invalid role attempted: ${role}`);
        return res.status(400).json({
          success: false,
          message: "Invalid role. Allowed: User, Astrologer",
        });
      }
      finalRole = role;
    }

    let currentUser = await User.findOne({ phone });

    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (currentUser) {
      currentUser.otp = otp;
      currentUser.otpExpires = otpExpires;
      await currentUser.save();

      logger.info(`OTP resent to existing user: ${phone}`);
    } else {
      currentUser = await User.create({
        phone,
        role: finalRole,
        otp: otp,
        otpExpires,
        isVerified: true,
        userStatus: "Active",
      });
      await currentUser.save();

      logger.info(`New user registered with role: ${finalRole}`);


    }


    // const otpSent = await sendOtpMSG91(phone, otp);

    // if (!otpSent) {
    //   return res.status(500).json({
    //     success: false,
    //     message: "Failed to send OTP. Try again.",
    //   });
    // }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully.",
      data: {
        phone: currentUser.phone,
        role: currentUser.role,
        userId: currentUser._id,
        otpExpires: currentUser.otpExpires,
      },
    });
  } catch (error) {
    logger.error(`Error in registerController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export const LogoutController = async (req, res) => {
  try {
    const userId = req.user.id;
    // Assuming userId is extracted from a verified token via middleware
    // Clear refreshToken, otp, otpExpires, set isOnline to false, and update lastSeen in the database
    await User.findByIdAndUpdate(
      userId,
      {
        refreshToken: null,
        otp: null,
        otpExpires: null,
        isOnline: false,
        lastSeen: new Date(),
      },
      { new: true }
    );

    // In React Native, the token is stored in AsyncStorage, not cookies
    // Simply return a success response
    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error(`Error in LogoutController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const UpdateProfileStepController = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { step } = req.params; // Step number (1, 2, 3, or 4)
    const data = req.body;
    let isProfileComplete = false;

    let updateFields = {};

    switch (step) {
      case "1":
        // Step 1: Update fullName and gender
        if (!data.fullName?.trim() || !data.gender?.trim()) {
          return res.status(400).json({
            success: false,
            message: "fullName and gender are required for step 1",
          });
        }

        updateFields = {
          fullName: data.fullName.trim(),
          gender: data.gender.trim(),
        };
        break;

      case "2":
        // Step 2: Update date, time, accuracy, and place
        if (
          !data.timeOfBirth ||
          !data.dateOfBirth ||
          data.isAccurate === undefined ||
          !data.placeOfBirth?.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "timeOfBirth, dateOfBirth, isAccurate, and placeOfBirth are required for step 2",
          });
        }

        // Ensure consistent date format
        const parsedDate = new Date(data.dateOfBirth);
        if (isNaN(parsedDate)) {
          return res.status(400).json({
            success: false,
            message: "Invalid date format. Use ISO format: YYYY-MM-DD",
          });
        }

        updateFields = {
          timeOfBirth: data.timeOfBirth, // e.g. "14:35" or "02:35 PM"
          dateOfBirth: parsedDate,
          isAccurate: Boolean(data.isAccurate),
          placeOfBirth: data.placeOfBirth.trim(),
          isProfileComplete: true, // Mark profile as complete after step 2
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          message: "Invalid step number. Use step 1 or 2.",
        });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select("fullName gender timeOfBirth dateOfBirth isAccurate placeOfBirth isProfileComplete");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Profile updated successfully for step ${step}`,
      data: updatedUser,
    });
  } catch (error) {
    logger.error(`Error in UpdateProfileStepController: ${error.stack}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const getProfileCompletionStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("isProfileComplete");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    return res.status(200).json({
      success: true,
      isProfileComplete: user.isProfileComplete,
    });
  } catch (error) {
    logger.error(`Error in getProfileCompletionStatus: ${error.stack}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};


export const UpdateProfileCompleteController = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const {
      fullName,
      gender,
      timeOfBirth,
      isAccurate,
      dateOfBirth,
      placeOfBirth,
    } = req.body;

    if (!fullName || !gender || !timeOfBirth || isAccurate === undefined || !dateOfBirth || !placeOfBirth) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    let photoUrl;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "profiles");
      photoUrl = result.secure_url;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          fullName,
          gender,
          timeOfBirth,
          isAccurate,
          dateOfBirth: new Date(dateOfBirth),
          placeOfBirth,
          ...(photoUrl && { photo: photoUrl }),
        },
      },
      { new: true, runValidators: true }
    ).select("fullName gender timeOfBirth isAccurate dateOfBirth placeOfBirth photo");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    logger.error(`Error in UpdateProfileCompleteController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const GetProfileController = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    // Fetch user profile with selected fields
    const user = await User.findById(userId).select(
      "fullName gender dateOfBirth timeOfBirth isAccurate placeOfBirth phone role isOnline userStatus isVerified lastSeen photo"
    );
    console.log(user.role["astrologer"]);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      data: {
        fullName: user.fullName || "",
        photo: user.photo || "",
        gender: user.gender || "",
        phone: user.phone || "", // Now phone will be availablephone: user.phone || "", // Now phone will be available
        dateOfBirth: user.dateOfBirth
          ? user.dateOfBirth.toISOString().split("T")[0]
          : "",
        timeOfBirth: user.timeOfBirth || "",
        isAccurate: user.isAccurate || false,
        placeOfBirth: user.placeOfBirth || "",
        isOnline: user.isOnline || false,
        userStatus: user.userStatus || "Inactive",
        isVerified: user.isVerified || false,
        lastSeen: user.lastSeen || null,
        role: user.role || "",
      },
    });
  } catch (error) {
    logger.error(`Error in GetProfileController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};



/**
 * Update User Profile (Enterprise Standard)
 */
export const updateUserProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const requesterRole = req.user?.role; // user | admin

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    /**
     * Base fields allowed for all authenticated users
     */
    const userAllowedFields = [
      "fullName",
      "email",
      "photo",
      "gender",
      "dateOfBirth",
      "timeOfBirth",
      "placeOfBirth",
      "isAccurate",
      "deviceToken",
    ];

    /**
     * Admin-only sensitive fields
     */
    const adminOnlyFields = [
      "userStatus",
      "isSuspend",
      "isVerified",
    ];

    const updatePayload = {};

    /**
     * Apply user-level fields
     */
    for (const field of userAllowedFields) {
      if (req.body[field] !== undefined) {
        updatePayload[field] = req.body[field];
      }
    }

    /**
     * Apply admin-only fields (strict gate)
     */
    if (requesterRole === "admin") {
      for (const field of adminOnlyFields) {
        if (req.body[field] !== undefined) {
          updatePayload[field] = req.body[field];
        }
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    /**
     * Normalization
     */
    if (updatePayload.email) {
      updatePayload.email = updatePayload.email.toLowerCase();
    }

    /**
     * Atomic update
     */
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updatePayload },
      {
        new: true,
        runValidators: true,
        projection: {
          password: 0,
          otp: 0,
          otpExpires: 0,
          refreshToken: 0,
        },
      }
    ).lean();

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};


export const adminGetUserProfile = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const user = await User.findById(targetUserId)
      .select(
        "-password -otp -otpExpires -refreshToken"
      )
      .lean();

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
    next(error);
  }
};


/**
 * Check Astrologer KYC Status
 * Enterprise-grade controller
 */

export const CheckKyc = async (req, res) => {
  try {
    const userId = req.user?._id;

    /* -------------------- VALIDATION -------------------- */
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing user ID",
      });
    }

    /* -------------------- USER CHECK -------------------- */
    const user = await User.findById(userId).select("role isSuspend userStatus");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role !== "astrologer") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Not an astrologer account",
        code: "NOT_ASTROLOGER"
      });
    }

    if (user.isSuspend || user.userStatus === "Blocked") {
      return res.status(403).json({
        success: false,
        message: "Account is suspended or blocked",
        code: "ACCOUNT_SUSPENDED"
      });
    }

    /* -------------------- ASTROLOGER PROFILE -------------------- */
    const astrologer = await Astrologer.findOne({ userId })
      .select("kyc accountStatus astrologerApproved isProfilecomplet")
      .lean();

    if (!astrologer) {
      return res.status(404).json({
        success: false,
        message: "Astrologer profile not found",
        code: "PROFILE_NOT_FOUND"
      });
    }

    /* -------------------- KYC LOGIC -------------------- */
    const hasKyc = astrologer.kyc !== null && astrologer.kyc !== undefined;
    
    // Check if KYC document exists and has all required fields
    const hasValidKyc = hasKyc && 
      astrologer.kyc.documentFront && 
      astrologer.kyc.documentBack && 
      astrologer.kyc.documentType;

    // Determine submission status
    const submitted = hasValidKyc;
    
    // Determine verification status based on accountStatus
    let verified = false;
    let rejected = false;
    
    if (astrologer.accountStatus === "approved") {
      verified = true;
      rejected = false;
    } else if (astrologer.accountStatus === "rejected") {
      verified = false;
      rejected = true;
    } else {
      verified = false;
      rejected = false;
    }

    const kycStatus = {
      submitted: submitted,
      verified: verified,
      rejected: rejected,
    };

    /* -------------------- DETERMINE NEXT STEP -------------------- */
    let nextStep = null;
    let shouldBlockAccess = false;

    // Check if profile is complete
    const isProfileComplete = astrologer.isProfilecomplet === true;
    
    if (!isProfileComplete) {
      nextStep = "complete_profile";
      shouldBlockAccess = true;
    } else if (!submitted) {
      nextStep = "submit_kyc";
      shouldBlockAccess = true;
    } else if (rejected) {
      nextStep = "resubmit_kyc";
      shouldBlockAccess = true;
    } else if (!verified && astrologer.accountStatus === "pending") {
      nextStep = "pending_approval";
      shouldBlockAccess = true;
    } else if (verified && astrologer.accountStatus === "approved") {
      nextStep = "approved";
      shouldBlockAccess = false;
    }

    /* -------------------- RESPONSE -------------------- */
    return res.status(200).json({
      success: true,
      kyc: kycStatus,
      accountStatus: astrologer.accountStatus,
      astrologerApproved: astrologer.astrologerApproved,
      isProfileComplete: isProfileComplete,
      nextStep: nextStep,
      canAccessDashboard: !shouldBlockAccess,
      message: shouldBlockAccess 
        ? `Account status: ${astrologer.accountStatus}. Please complete ${nextStep}`
        : "Account fully verified and approved"
    });
    
  } catch (error) {
    console.error("CheckKyc Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Add this to your astrologer controller
export const checkAstrologerVerification = async (req, res) => {
  try {
    const userId = req.user?._id;

    // Validation
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Get user with minimal data
    const user = await User.findById(userId).select("role isSuspend userStatus");
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Quick role check
    if (user.role !== "astrologer") {
      return res.status(200).json({
        success: true,
        isAstrologer: false,
        isVerified: false,
        message: "User is not an astrologer",
      });
    }

    // Account status check
    if (user.isSuspend || user.userStatus === "Blocked") {
      return res.status(200).json({
        success: true,
        isAstrologer: true,
        isVerified: false,
        isSuspended: true,
        message: "Account is suspended",
      });
    }

    // Get astrologer verification status
    const astrologer = await Astrologer.findOne({ userId })
      .select("accountStatus isProfilecomplet kyc")
      .lean();

    if (!astrologer) {
      return res.status(200).json({
        success: true,
        isAstrologer: true,
        isVerified: false,
        hasProfile: false,
        message: "Astrologer profile not found",
      });
    }

    // Comprehensive verification check
    const isFullyVerified = 
      astrologer.isProfilecomplet === true &&
      astrologer.kyc !== null &&
      astrologer.kyc !== undefined &&
      astrologer.accountStatus === "approved";

    // Determine verification status with details
    const verificationStatus = {
      isFullyVerified,
      hasProfile: astrologer.isProfilecomplet === true,
      hasKyc: astrologer.kyc !== null && astrologer.kyc !== undefined,
      accountStatus: astrologer.accountStatus,
      needsAction: !isFullyVerified,
      nextStep: !astrologer.isProfilecomplet 
        ? "complete_profile"
        : !astrologer.kyc 
        ? "submit_kyc"
        : astrologer.accountStatus === "rejected"
        ? "resubmit_kyc"
        : astrologer.accountStatus === "pending"
        ? "pending_approval"
        : null
    };

    return res.status(200).json({
      success: true,
      isAstrologer: true,
      isVerified: isFullyVerified,
      verificationStatus,
      message: isFullyVerified 
        ? "Astrologer is fully verified"
        : "Astrologer verification incomplete",
    });

  } catch (error) {
    console.error("Check Astrologer Verification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};