// utils/firebaseAdmin.js
import admin from 'firebase-admin';
import { JWT } from 'google-auth-library';

let firebaseAdminInstance = null;

/**
 * Initializes Firebase Admin once and reuses it.
 */
export async function initFirebaseAdmin() {
  // Return existing initialized instance
  if (firebaseAdminInstance && admin.apps.length) return firebaseAdminInstance;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM disabled');
    return null;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    console.error(
      '❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:',
      err.message
    );
    return null;
  }

  // Fix escaped newlines in private key
  if (serviceAccount.private_key?.includes('\\n')) {
    serviceAccount.private_key = serviceAccount.private_key.replace(
      /\\n/g,
      '\n'
    );
  }

  // Verify credentials (optional but helpful)
  try {
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [
        'https://www.googleapis.com/auth/firebase.messaging',
        'https://www.googleapis.com/auth/cloud-platform',
      ],
    });
    await jwtClient.authorize();
    console.log('🔐 Firebase credentials verified successfully');
  } catch (err) {
    console.error('❌ Failed to verify Firebase credentials:', err.message);
    console.error('➡️ Re-download a new key from Firebase Console.');
    return null;
  }

  // Initialize Firebase Admin
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized');
    firebaseAdminInstance = admin;
    return firebaseAdminInstance;
  } catch (err) {
    console.error('❌ Failed to initialize Firebase Admin:', err.message);
    return null;
  }
}
