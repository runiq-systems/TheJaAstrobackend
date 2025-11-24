import jwt from "jsonwebtoken";
import { User } from "../models/user.js";
import logger from "../utils/logger.js";

/**
 * Middleware to protect routes and ensure the user is authenticated
 */
export async function authMiddleware(req, res, next) {
  try {
    // 1️⃣ Check Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Missing or malformed Authorization header");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2️⃣ Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      console.log("Decoded JWT:", decoded);
    } catch (error) {
      logger.warn(`JWT verification failed: ${error.message}`);
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid or expired token",
      });
    }

    // 3️⃣ Find user in DB
    const user = await User.findById(decoded.id).select(
      "-otp -otpExpires -password"
    ); // exclude sensitive fields

    if (!user) {
      logger.warn("User not found for given token");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User does not exist",
      });
    }

    // 4️⃣ Check if user is active
    // if (user.userStatus !== "active") {
    //   logger.warn(`Blocked or inactive user attempted access: ${user._id}`);
    //   return res.status(403).json({
    //     success: false,
    //     message: "Forbidden: User account not active",
    //   });
    // }

    // 5️⃣ Attach user to request for downstream controllers
    req.user = user;

    next();
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal server error in auth middleware",
    });
  }
}

export async function adminMiddleware(req, res, next) {
  try {
    // 1️⃣ Check Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Missing or malformed Authorization header");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2️⃣ Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      console.log("Decoded JWT:", decoded);
    } catch (error) {
      logger.warn(`JWT verification failed: ${error.message}`);
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid or expired token",
      });
    }

    // 3️⃣ Find user in DB
    const user = await User.findById(decoded.id).select(
      "-otp -otpExpires -password"
    ); // exclude sensitive fields

    if (!user) {
      logger.warn("User not found for given token");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User does not exist",
      });
    }


    if (user.role !== "admin") {
      logger.warn(
        `AdminAuth: User ${user._id} attempted admin access. Role = ${user.role}`
      );
      return res.status(403).json({
        success: false,
        message: "Forbidden: Admin access required",
      });
    }


    // 4️⃣ Check if user is active
    // if (user.userStatus !== "active") {
    //   logger.warn(`Blocked or inactive user attempted access: ${user._id}`);
    //   return res.status(403).json({
    //     success: false,
    //     message: "Forbidden: User account not active",
    //   });
    // }

    // 5️⃣ Attach user to request for downstream controllers
    req.user = user;

    next();
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal server error in auth middleware",
    });
  }
}





