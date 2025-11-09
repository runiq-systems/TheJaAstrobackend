import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Parse the service account JSON safely
let serviceAccount = null;

try {
  if (process.env.serviceAccount) {
    serviceAccount = JSON.parse(process.env.serviceAccount);
  } else if (process.env.serviceAccount1) {
    serviceAccount = JSON.parse(process.env.serviceAccount1);
  }
} catch (error) {
  console.error("Error parsing Firebase service account JSON:", error);
  process.exit(1); // Exit if there's an issue with the credentials
}

if (!serviceAccount) {
  throw new Error("No valid Firebase service account found.");
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;