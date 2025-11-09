import admin from 'firebase-admin';
import dotenv from 'dotenv';
import logger from './logger.js';
dotenv.config();

// Parse the service account JSON from environment variable
// console.log("process.env.serviceAccount",process.env.serviceAccount)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE);

// Fix private_key (replace escaped "\n" with actual newlines)
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
logger.info('Firebase init Done',serviceAccount)

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

export default admin;