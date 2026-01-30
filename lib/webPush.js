const webpush = require("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

const isConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("Web Push disabled: missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.");
}

async function sendWebPush(subscriptions, payload) {
  if (!isConfigured) return { sent: 0, expired: [] };
  if (!subscriptions || !subscriptions.length) return { sent: 0, expired: [] };

  const expired = [];
  let sent = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        expired.push(sub.endpoint);
      } else {
        console.error("Web Push send error:", err?.message || err);
      }
    }
  }

  return { sent, expired };
}

module.exports = { sendWebPush };
