import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

// Parse the service account JSON from environment variable
// console.log("process.env.serviceAccount",process.env.serviceAccount)
const serviceAccount = JSON.parse(process.env.serviceAccount);

// Fix private_key (replace escaped "\n" with actual newlines)
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log("Firebase Admin SDK initialized with service account",serviceAccount);

export default admin;