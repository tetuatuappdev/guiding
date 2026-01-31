function getPublicBaseUrl() {
  const raw =
    process.env.PWA_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    "https://guiding-pwa.vercel.app";
  return String(raw || "").replace(/\/+$/, "");
}

function getWebPushIconUrl() {
  const base = getPublicBaseUrl();
  return process.env.WEB_PUSH_ICON_URL || `${base}/icons/notify.svg`;
}

function getWebPushBadgeUrl() {
  const base = getPublicBaseUrl();
  return process.env.WEB_PUSH_BADGE_URL || `${base}/icons/notify.svg`;
}

function withWebPushDefaults(payload) {
  const icon = getWebPushIconUrl();
  const badge = getWebPushBadgeUrl();
  return {
    ...payload,
    icon: payload?.icon || icon,
    badge: payload?.badge || badge,
  };
}

module.exports = { withWebPushDefaults };
