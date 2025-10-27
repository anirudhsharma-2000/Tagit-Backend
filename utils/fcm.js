// utils/fcm.js
import { initFirebaseAdmin } from './firebaseAdmin.js';

const admin = initFirebaseAdmin(); // returns admin module or null

export async function sendFcmToTokens(
  tokens = [],
  notification = {},
  data = {}
) {
  if (!admin) {
    console.warn('FCM admin not initialized — skipping send');
    return { successCount: 0, failureCount: tokens.length, responses: [] };
  }

  const validTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  if (!validTokens.length)
    return { successCount: 0, failureCount: 0, responses: [] };

  const message = {
    tokens: validTokens,
    notification:
      notification.title || notification.body ? notification : undefined,
    data:
      data && Object.keys(data).length
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          )
        : undefined,
  };

  try {
    // for firebase-admin v11+, use sendEachForMulticast
    const res = await admin.messaging().sendEachForMulticast(message);
    console.log(`📨 FCM sent ${res.successCount}/${validTokens.length}`);
    if (res.failureCount) {
      console.warn(
        '⚠️ FCM failures:',
        res.responses.filter((r) => !r.success)
      );
    }
    return res;
  } catch (err) {
    console.error('FCM sendMulticast error', err);
    return { successCount: 0, failureCount: validTokens.length, error: err };
  }
}
