import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5000,
  message: {
    success: false,
    message: "Too many requests from this source. Please try again after 10 minutes.",
  },
});

/**
 * Generic factory (reusable)
 */
const createRateLimiter = ({
  windowMs,
  max,
  message,
}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Return RateLimit-* headers
    legacyHeaders: false,    // Disable X-RateLimit-* headers
    message: {
      success: false,
      message,
    },
  });

/**
 * 🚨 OTP send / register
 * Protects against SMS bombing
 */
export const registerLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 5,                  // 5 attempts per IP
  message:
    "Too many registration attempts. Please try again after 10 minutes.",
});

/**
 * 🚨 OTP verification
 * Protects against brute force
 */
export const verifyOtpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,                 // 10 OTP attempts
  message:
    "Too many OTP verification attempts. Please wait before trying again.",
});

/**
 * ⚠️ Authenticated user actions
 */
export const authActionLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 60,                // 60 req/min
  message:
    "Too many requests. Slow down.",
});


/**
 * 10 requests per user/IP for astrology APIs
 */
export const astrologyRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1,

  keyGenerator: (req) => {
    // ✅ Prefer authenticated user
    if (req.user?._id) {
      return `user:${req.user._id}`;
    }

    // ⚠️ Fallback to IP
    return `ip:${req.ip}`;
  },

  handler: (req, res) => {
    return res.status(429).json({
      status: "error",
      message:
        "Daily astrology API limit reached (10 requests). Try again tomorrow.",
    });
  },

  standardHeaders: true,
  legacyHeaders: false,
});
