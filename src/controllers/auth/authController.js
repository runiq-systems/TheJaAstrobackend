import logger from "../../utils/logger.js";
import { User } from "../../models/user.js";
import { generateOtp } from "../../utils/generateOtp.js";

export async function registerController(req, res) {
  const { phone } = req.body;

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

  try {
    let currentUser = await User.findOne({ phone });

    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (currentUser) {
      // User exists, update OTP
      currentUser.otp = otp;
      currentUser.otpExpires = otpExpires;
      await currentUser.save();
      logger.info(`OTP resent to existing user: ${phone}`);
    } else {
      // New user registration
      currentUser = new User({
        phone,
        otp,
        otpExpires,
        isVerified: false,
        userStatus: "InActive",
      });
      await currentUser.save();
      // logger.info(`New user registered: ${phone}`);
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully.",
      data: {
        phone: currentUser.phone,
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
        lastSeen: new Date()
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
        if (!data.fullName || !data.gender) {
          return res.status(400).json({
            success: false,
            message: "fullName and gender are required for step 1",
          });
        }
        updateFields = {
          fullName: data.fullName,
          gender: data.gender,
        };
        break;
      case "2":
        // Step 2: Update timeOfBirth and isAccurate
        if (!data.timeOfBirth || data.isAccurate === undefined) {
          return res.status(400).json({
            success: false,
            message: "timeOfBirth and isAccurate are required for step 2",
          });
        }
        updateFields = {
          timeOfBirth: data.timeOfBirth,
          isAccurate: data.isAccurate,
        };
        break;
      case "3":
        // Step 3: Update dateOfBirth
        if (!data.dateOfBirth) {
          return res.status(400).json({
            success: false,
            message: "dateOfBirth is required for step 3",
          });
        }
        updateFields = {
          dateOfBirth: new Date(data.dateOfBirth),
        };
        break;
      case "4":
        // Step 4: Update placeOfBirth
        if (!data.placeOfBirth) {
          return res.status(400).json({
            success: false,
            message: "placeOfBirth is required for step 4",
          });
        }
        updateFields = {
          placeOfBirth: data.placeOfBirth,
        };
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Invalid step number",
        });
    }

    // Update user in the database
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
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
      message: `Profile updated successfully for step ${step}`,
      data: updatedUser,
    });
  } catch (error) {
    logger.error(`Error in UpdateProfileStepController: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const UpdateProfileCompleteController = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { fullName, gender, timeOfBirth, isAccurate, dateOfBirth, placeOfBirth } = req.body;

    // Validate all required fields
    if (!fullName || !gender || !timeOfBirth || isAccurate === undefined || !dateOfBirth || !placeOfBirth) {
      return res.status(400).json({
        success: false,
        message: "All fields (fullName, gender, timeOfBirth, isAccurate, dateOfBirth, placeOfBirth) are required",
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
      "fullName gender dateOfBirth timeOfBirth isAccurate placeOfBirth"
    );

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
        dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().split("T")[0] : "",
        timeOfBirth: user.timeOfBirth || "",
        isAccurate: user.isAccurate || false,
        placeOfBirth: user.placeOfBirth || "",
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