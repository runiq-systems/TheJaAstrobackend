import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  message: {
    success: false,
    message: "Too many requests from this source. Please try again after 10 minutes.",
  },
});