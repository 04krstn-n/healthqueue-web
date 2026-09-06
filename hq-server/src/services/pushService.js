/**
 * Push notification service — Firebase Cloud Messaging (FCM).
 *
 * This is what actually lets a patient receive a notification while the
 * app is backgrounded or fully closed. The existing Notification.create()
 * calls elsewhere in this codebase only ever wrote an in-app record the
 * patient would see the NEXT time they opened the app and it fetched
 * GET /notifications — there was no way to reach a device that wasn't
 * actively running the app in the foreground.
 *
 * Requires:
 *   npm install firebase-admin
 *
 * Environment variable:
 *   FIREBASE_SERVICE_ACCOUNT_KEY — the full JSON contents of a Firebase
 *   service account key (Project Settings -> Service Accounts -> Generate
 *   new private key), as a single-line JSON string.
 *
 * If this env var isn't set, sendPushToUser() silently no-ops (logs once
 * at startup, then just skips sending on every call) rather than
 * throwing — matching how this codebase already treats Semaphore/OpenAI/
 * Rasa as optional, feature-detected integrations rather than hard
 * dependencies. The in-app Notification record (see utils/notify.js)
 * still gets created either way.
 */
const User = require('../models/User');

let admin = null;
let firebaseReady = false;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    admin = require('firebase-admin');
    const serviceAccount = JSON.parse(raw);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firebaseReady = true;
    console.log('[Push] Firebase Admin initialized — push notifications enabled.');
  } else {
    console.warn('[Push] FIREBASE_SERVICE_ACCOUNT_KEY not set — push notifications disabled (in-app notifications still work).');
  }
} catch (err) {
  console.error('[Push] Failed to initialize Firebase Admin:', err.message);
  firebaseReady = false;
}

/**
 * Sends a push notification to a single user's registered device, if any.
 * Never throws — a push failure should never break the caller's actual
 * request (e.g. calling a patient's queue number must succeed even if
 * their push token is stale/invalid).
 */
async function sendPushToUser(userId, { title, message, data = {} }) {
  if (!firebaseReady || !userId) return;

  try {
    const user = await User.findById(userId).select('+fcmToken');
    const token = user?.fcmToken;
    if (!token) return; // no device registered — normal, not an error

    // `notification` (not just `data`) is what makes Android/iOS display
    // this automatically while the app is backgrounded or terminated,
    // with zero client-side code needed for that specific case — the
    // OS handles it. `data` is still included so the app can navigate
    // to the right screen if the user taps it.
    await admin.messaging().send({
      token,
      notification: { title, body: message },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]) // FCM data payload values must be strings
      ),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    // A common cause here is a stale/uninstalled-app token
    // ('messaging/registration-token-not-registered') — clear it so we
    // stop trying to push to a dead token every time.
    if (err.code === 'messaging/registration-token-not-registered') {
      await User.findByIdAndUpdate(userId, { fcmToken: null }).catch(() => {});
    }
    console.warn(`[Push] Failed to send to user ${userId}:`, err.message);
  }
}

module.exports = { sendPushToUser, isFirebaseReady: () => firebaseReady };
