// utils/fcm.js
import { initFirebaseAdmin } from './firebaseAdmin.js';

/**
 * Sends an FCM notification to multiple device tokens.
 */
export async function sendFcmToTokens(
  tokens = [],
  notification = {},
  data = {}
) {
  const admin = await initFirebaseAdmin(); // ✅ Await initialization properly
  if (!admin) {
    console.warn('⚠️ FCM admin not initialized — skipping send');
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
    const messaging = admin.messaging();
    const sendFn =
      typeof messaging.sendEachForMulticast === 'function'
        ? messaging.sendEachForMulticast.bind(messaging)
        : messaging.sendMulticast.bind(messaging);

    const res = await sendFn(message);
    console.log(`📨 FCM sent ${res.successCount}/${validTokens.length}`);

    if (res.failureCount) {
      console.warn(
        '⚠️ FCM failures:',
        res.responses.filter((r) => !r.success)
      );
    }

    return res;
  } catch (err) {
    console.error('❌ FCM send error:', err);
    return { successCount: 0, failureCount: validTokens.length, error: err };
  }
}
