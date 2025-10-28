import express from "express";
import cookieParser from "cookie-parser";
import requestIp from "request-ip";
import { Server } from "socket.io";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";
import { rateLimiter } from "./middleware/ratelimiter.js";
import errorHandler from "./middleware/errorHandler.js";

import indexRoute from "./routes/indexRoute.js"
import authRoute from "./routes/authRoute.js"
import chatmessageRoute from './routes/chatapp/chatRoutes.js'
import { initializeSocketIO } from "./socket/index.js";
import { setupWebRTC } from "./webrtc/webrtc.service.js";
const app = express();
dotenv.config({
    path: "./.env",
});


const httpserver = createServer(app);

app.set('trust proxy', 1)


const io = new Server(httpserver, {
    pingTimeout: 60000,
    cors: {
        origin: "*",
        credentials: true,
    },
});
app.set("io", io);

initializeSocketIO(io);
// Setup WebRTC service
const webrtcService = setupWebRTC(io);

// Optional: Add monitoring endpoint
app.get('/api/webrtc/stats', (req, res) => {
    res.json(webrtcService.getServiceStats());
});


app.get("/", (req, res) => {
    res.send("API is running...");
}
);

app.use(requestIp.mw());
app.use(rateLimiter);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());
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
app.use("/api/v1", authRoute)
app.use("/api/v1/chat", chatmessageRoute)

app.use(errorHandler)
export default httpserver;
