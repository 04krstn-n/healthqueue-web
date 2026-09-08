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
  // FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is checked first — pasting the raw
  // multi-line JSON into Heroku's Config Vars web form is a very common
  // source of corruption, since the `private_key` field inside it contains
  // literal \n escape sequences representing line breaks in the PEM key,
  // and those are easy to accidentally mangle in a paste. A base64-encoded
  // version has no newlines or special characters at all, so there's
  // nothing left to corrupt — generate it with, e.g.:
  //   base64 -w0 your-service-account-key.json     (Linux/macOS)
  //   certutil -encode key.json key.b64             (Windows, then strip
  //     the ----BEGIN/END----- header/footer lines certutil adds)
  // or any online base64 encoder, then set that as
  // FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 instead of the plain JSON var.
  // Base64 is checked FIRST now, not as a fallback — if both vars happen
  // to be set (e.g. the original FIREBASE_SERVICE_ACCOUNT_KEY was never
  // deleted after switching to the base64 approach), the reliable one
  // should always win rather than silently using whichever one happens
  // to be checked first.
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf-8')
    : process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const usedSource = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64
    ? 'FIREBASE_SERVICE_ACCOUNT_KEY_BASE64'
    : 'FIREBASE_SERVICE_ACCOUNT_KEY';
  if (raw) {
    console.log(`[Push] Reading credentials from ${usedSource}.`);
    admin = require('firebase-admin');
    // Some firebase-admin versions ship both ESM and CommonJS builds, and
    // depending on exactly how that package resolves through require(),
    // the actual SDK (credential, initializeApp, etc.) can end up nested
    // under admin.default instead of directly on admin — which is
    // exactly what the "Cannot read properties of undefined (reading
    // 'cert')" error means: admin itself loaded fine, but admin.credential
    // specifically wasn't where this code expected it.
    if (!admin.credential && admin.default) {
      admin = admin.default;
    }
    if (!admin.credential) {
      throw new Error(
        `firebase-admin loaded but has no .credential — got keys: [${Object.keys(admin).join(', ')}]. ` +
        'This usually means an incompatible firebase-admin version got installed; check package.json/package-lock.json.'
      );
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch (parseErr) {
      throw new Error(`Could not parse service account JSON — likely corrupted in transit (see the base64 note above). ${parseErr.message}`);
    }
    if (!serviceAccount.private_key || !serviceAccount.private_key.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Parsed JSON is missing a valid private_key field — the key was likely mangled during copy/paste. Try the base64 approach described above.');
    }
    // Was `if (!admin.apps.length) { admin.initializeApp(...) }` — that
    // relies on `admin.apps` being shaped a specific way, which can vary
    // across firebase-admin SDK versions (this project has no version
    // pin, so `npm install firebase-admin` always grabs whatever's
    // newest). Try/catching the actual initializeApp() call instead and
    // only ignoring the specific "already exists" error sidesteps that
    // entirely — it doesn't matter what shape `admin.apps` has in
    // whatever version got installed.
    try {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (initErr) {
      if (!/already exists/i.test(initErr.message)) {
        throw initErr;
      }
    }
    firebaseReady = true;
    console.log('[Push] Firebase Admin initialized — push notifications enabled.');
  } else {
    console.warn('[Push] FIREBASE_SERVICE_ACCOUNT_KEY not set — push notifications disabled (in-app notifications still work).');
  }
} catch (err) {
  console.error('[Push] Failed to initialize Firebase Admin:', err.message);
  console.error(err.stack);
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
