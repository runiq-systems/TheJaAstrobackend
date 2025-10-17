import dotenv from "dotenv";
import httpServer from "./app.js";
// import connectDB from "./config/db.js";
import connectDB from "./config/db.js"
import colors from "colors"
dotenv.config({
    path: "./.env",
});
/**
 * Starting from Node.js v14 top-level await is available and it is only available in ES modules.
 * This means you can not use it with common js modules or Node version < 14.
 */
const majorNodeVersion = +process.env.NODE_VERSION?.split(".")[0] || 0;

const startServer = async () => {

    httpServer.listen(process.env.PORT || 8080, () => {
        console.log((`\n⚙️  Server is running on port:  http://localhost:${process.env.PORT} \n`).bgWhite.black);
    });
};

if (majorNodeVersion >= 14) {
    try {
        await connectDB();
        startServer();
    } catch (err) {
        console.log("Mongo db connect error: ", err);
    }
} else {
    connectDB()
        .then(() => {
            startServer();
        })
        .catch((err) => {
            console.log("Mongo db connect error: ", err);
        });
}
