const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { sendExpoPush } = require("../lib/expoPush");

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
  const whenText = timeText ? ` à ${timeText}` : "";

  return sendExpoPush(tokens, {
    title: "Rappel tour demain ⏰",
    body: `Tu as un tour demain${whenText}.`,
    data: { type: "tour_reminder", date, times },
  });
}

module.exports = {
  notifyTourPaid,
  notifyNewToursPublished,
  notifyTourReminder,
};
