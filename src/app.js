import express from "express";
import cookieParser from "cookie-parser";
import requestIp from "request-ip";
// import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { rateLimiter } from "./middleware/ratelimiter.js";
import errorHandler from "./middleware/errorHandler.js";

import indexRoute from "./routes/indexRoute.js"

const app = express();

dotenv.config({
    path: "./.env",
});

// Connection socket
// const io = new Server(server, {
//     pingTimeout: 60000,
//     cors: {
//         origin: "*",
//         credentials: true,
//     },
// });


// Middleware
app.use(requestIp.mw());
app.use(rateLimiter);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());
app.use(errorHandler)
app.use(
    cors({
        origin:
            process.env.CORS_ORIGIN === "*"
                ? "*"
                : process.env.CORS_ORIGIN?.split(","),
        credentials: true,
    })
);



// Routes
app.use("/api/v1", indexRoute)

export default app