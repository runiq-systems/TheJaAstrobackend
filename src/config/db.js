import mongoose from 'mongoose';
import colors from 'colors';
// import { DB_NAME } from "../constants.js";

/** @type {typeof mongoose | undefined} */
export let dbInstance = undefined;
const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(
            `${process.env.MONGO_URI}`
        );
        dbInstance = connectionInstance;
        console.log(
            `\n☘️  MongoDB Connected succsessfully!😎\n`.bgGreen.white
        );
    } catch (error) {
        console.log("MongoDB connection error: ", error.red, error);
        process.exit(1);
    }
};
export default connectDB;