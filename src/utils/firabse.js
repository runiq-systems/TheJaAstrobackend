import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let serviceAccount = null;

try {
  const jsonStr = process.env.serviceAccount || process.env.serviceAccount1;
  if (!jsonStr) throw new Error('Firebase service account not set');
  serviceAccount = JSON.parse(jsonStr);

  // Fix private key newlines
  if (serviceAccount.private_key?.includes('\\n')) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} catch (err) {
  console.error('❌ Error parsing Firebase credentials:', err);
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase initialized successfully');
} catch (err) {
  console.error('❌ Firebase init failed:', err);
}

export default admin;
