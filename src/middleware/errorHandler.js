import logger from "../utils/logger.js"

export default async function errorHandler(err, req, res, next) {
    logger.error(err.stack)
    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Error Handling Occurred..."
    })
}