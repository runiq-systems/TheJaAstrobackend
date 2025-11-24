import logger from "../../utils/logger.js";
import { User } from "../../models/user.js";
import { generateOtp } from "../../utils/generateOtp.js";
import { Astrologer } from "../../models/astrologer.js";

export async function registerController(req, res) {
  try {
    const { phone, role } = req.body;

    // -----------------------------
    // Validate Phone
    //------------------------------
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

    // -----------------------------
    // Validate Role
    //------------------------------
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

    // -----------------------------
    // Existing User
    //------------------------------
    let currentUser = await User.findOne({ phone });
    // if (currentUser && currentUser.role !== finalRole) {
    //   logger.warn(`Role mismatch for phone ${phone}: existing role ${currentUser.role}, attempted role ${finalRole}`);
    //   return res.status(400).json({
    //     success: false,
    //     message: `User already registered as ${currentUser.role}.`,
    //   });
    // }

    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (currentUser) {
      // update OTP only
      currentUser.otp = otp;
      currentUser.otpExpires = otpExpires;
      await currentUser.save();

      logger.info(`OTP resent to existing user: ${phone}`);
    } else {
      // -----------------------------
      // Register New User
      //------------------------------
      currentUser = new User({
        phone,
        role: finalRole,
        otp,
        otpExpires,
        isVerified: false,
        userStatus: "InActive",
      });

      await currentUser.save();

      logger.info(`New user registered with role: ${finalRole}`);

      // -----------------------------
      // If Role = Astrologer → Create Astrologer Profile
      //------------------------------
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
    ).select("fullName gender timeOfBirth dateOfBirth isAccurate placeOfBirth");

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

    // Validate all required fields
    if (
      !fullName ||
      !gender ||
      !timeOfBirth ||
      isAccurate === undefined ||
      !dateOfBirth ||
      !placeOfBirth
    ) {
      return res.status(400).json({
        success: false,
        message:
          "All fields (fullName, gender, timeOfBirth, isAccurate, dateOfBirth, placeOfBirth) are required",
      });
    }

    // Update user in the database
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
        },
      },
      { new: true, runValidators: true }
    ).select("fullName gender timeOfBirth isAccurate dateOfBirth placeOfBirth");

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
      "fullName gender dateOfBirth timeOfBirth isAccurate placeOfBirth phone role isOnline userStatus isVerified lastSeen"
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
