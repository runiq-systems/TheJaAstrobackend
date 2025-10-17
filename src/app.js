import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import requestIp from "request-ip";
import { Server } from "socket.io";
import colors from "colors";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import dotenv from "dotenv";

const app = express();

dotenv.config({
    path: "./.env",
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
    pingTimeout: 60000,
    cors: {
        origin: "*",
        credentials: true,
    },
});





// global middlewares
app.use(
    cors({
        origin:
            process.env.CORS_ORIGIN === "*"
                ? "*"
                : process.env.CORS_ORIGIN?.split(","),
        credentials: true,
    })
);

app.use(requestIp.mw());

app.set('trust proxy', 1)

// Rate limiter to avoid misuse of the service and avoid cost spikes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000, // Limit each IP to 500 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public")); // configure static file to save images locally
app.use(cookieParser());

app.use(
    session({
        secret: process.env.SESSION_SECRET || "supersecretkey",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false, // true if using https
            maxAge: 1000 * 60 * 60 * 24, // 1 day
        },
    })
);





app.get("/", (req, res) => {
    try {
        res.send("TheJa Astro Running Smoothly");
        throw new Error("BROKEN");
    } catch (error) {
        logger.error(error);
    }
});




export default httpServer;
