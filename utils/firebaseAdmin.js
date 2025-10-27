// utils/firebaseAdmin.js
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

let firebaseAdminInstance = null;

export function initFirebaseAdmin() {
  if (firebaseAdminInstance) return firebaseAdminInstance;

  // Load service account JSON from file
  const filePath = path.resolve('./utils/firebase-admin.json');
  if (!fs.existsSync(filePath)) {
    console.error(
      'Firebase service account JSON file not found — FCM disabled'
    );
    return null;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('Failed to parse Firebase service account JSON:', err);
    return null;
  }

  try {
    firebaseAdminInstance = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized');
    return firebaseAdminInstance;
  } catch (err) {
    console.error('Failed to initialize Firebase Admin:', err);
    return null;
  }
}
