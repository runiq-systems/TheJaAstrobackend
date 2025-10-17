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
  const isDevelopment = env === "development";
  return isDevelopment ? "debug" : "warn";
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
  // Timestamp for each log
  winston.format.timestamp({ format: "DD MMM YYYY - HH:mm:ss:ms" }),
  // Colorize only level (not full line)
  winston.format.colorize({ all: true }),
  // Custom format
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

// ==================== 5️⃣ Define Transports ====================
const transports = [
  new winston.transports.Console(),
];

// ==================== 6️⃣ Create Logger ====================
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

// ==================== 7️⃣ If Not in Production, Log to Console with Colors ====================
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

export default logger;
