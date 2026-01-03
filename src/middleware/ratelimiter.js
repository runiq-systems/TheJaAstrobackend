import rateLimit from "express-rate-limit";
import requestIp from "request-ip";

const ipKeyGenerator = (req) => {
  const ip =
    requestIp.getClientIp(req) ||
    req.ip ||
    "unknown";

  return ip.replace(/:/g, "");
};

const createRateLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

export const registerLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "Too many registration attempts. Please try again after 10 minutes.",
});

export const verifyOtpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Too many OTP verification attempts. Please wait.",
});

export const rateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many requests. Slow down.",
});

export const astrologyRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,

  keyGenerator: (req) =>
    req.user?._id
      ? `user:${req.user._id}`
      : `ip:${ipKeyGenerator(req)}`,

  handler: (req, res) =>
    res.status(429).json({
      status: "error",
      message: "Daily astrology API limit reached.",
    }),

  standardHeaders: true,
  legacyHeaders: false,
});
