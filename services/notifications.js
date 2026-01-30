const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { sendExpoPush } = require("../lib/expoPush");
const { sendWebPush } = require("../lib/webPush");

async function getTokensForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);

  if (error) throw error;
  return (data || []).map((r) => r.expo_push_token).filter(Boolean);
}

async function getTokensForUsers(userIds) {
  if (!userIds || !userIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("expo_push_token")
    .in("user_id", userIds);

  if (error) throw error;
  return (data || []).map((r) => r.expo_push_token).filter(Boolean);
}

async function getWebPushSubsForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from("web_push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) throw error;
  return data || [];
}

async function cleanupExpiredSubs(endpoints) {
  if (!endpoints || !endpoints.length) return;
  await supabaseAdmin.from("web_push_subscriptions").delete().in("endpoint", endpoints);
}

async function notifyTourPaid({ guideUserId, slotId, amount, currency }) {
  const tokens = await getTokensForUser(guideUserId);

  const amountText =
    typeof amount === "number" ? ` (${amount}${currency || "€"})` : "";

    console.log("notifyTourPaid", {
  guideUserId,
  tokensCount: tokens.length,
});

  return sendExpoPush(tokens, {
    title: "Tour payé ✅",
    body: `Ton tour a été marqué comme payé${amountText}.`,
    data: { type: "tour_paid", slotId },
  });
}

async function notifyNewToursPublished({ guideUserIds, monthLabel, count }) {
  const tokens = await getTokensForUsers(guideUserIds);
  const when = monthLabel ? ` for ${monthLabel}` : "";
  const suffix = count ? ` (${count} new slots)` : "";

  return sendExpoPush(tokens, {
    title: "New tours published 📅",
    body: `New tours published${when}${suffix}. You can consult your affected tour on the app.`,
    data: { type: "new_tours_published" },
  });
}

async function notifyTourReminder({ guideUserId, times, date }) {
  const tokens = await getTokensForUser(guideUserId);
  const timeText = Array.isArray(times) ? times.join(", ") : String(times || "");
  const whenText = timeText ? ` at ${timeText}` : "";

  const title = "Tour reminder";
  const body = `You have a tour tomorrow${whenText}.`;
  const data = { type: "tour_reminder", date, times };

  const webSubs = await getWebPushSubsForUser(guideUserId);
  const { expired } = await sendWebPush(webSubs, { title, body, data });
  await cleanupExpiredSubs(expired);

  return sendExpoPush(tokens, { title, body, data });
}

module.exports = {
  notifyTourPaid,
  notifyNewToursPublished,
  notifyTourReminder,
};
