import winston from "winston";

// ==================== 1️⃣ Define Log Levels ====================
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// ==================== 2️⃣ Set Level Based on Environment ====================
const level = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "development" ? "debug" : "info"; // show more in dev, less in prod
};

// ==================== 3️⃣ Define Colors for Each Level ====================
const colors = {
  error: "red",
  warn: "yellow",
  info: "cyan",
  http: "magenta",
  debug: "white",
};
winston.addColors(colors);

// ==================== 4️⃣ Define Log Format ====================
const format = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "DD MMM YYYY - HH:mm:ss:ms" }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

// ==================== 5️⃣ Define Transports ====================
const transports = [new winston.transports.Console()];

// ==================== 6️⃣ Create and Export Logger ====================
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;
