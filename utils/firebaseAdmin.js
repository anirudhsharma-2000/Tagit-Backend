// utils/firebaseAdmin.js
import admin from 'firebase-admin';

let firebaseAdminInstance = null;

export function initFirebaseAdmin() {
  if (firebaseAdminInstance) return firebaseAdminInstance;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM disabled');
    return null;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err);
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
