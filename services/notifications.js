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

  return sendExpoPush(tokens, {
    title: "Tour payé ✅",
    body: `Ton tour a été marqué comme payé${amountText}.`,
    data: { type: "tour_paid", slotId },
  });
}

async function notifyNewToursPublished({ guideUserIds, monthLabel, count }) {
  const tokens = await getTokensForUsers(guideUserIds);
  const when = monthLabel ? ` pour ${monthLabel}` : "";
  const suffix = count ? ` (${count} nouveaux créneaux)` : "";

  return sendExpoPush(tokens, {
    title: "Nouveaux tours publiés 📅",
    body: `De nouveaux tours sont disponibles${when}${suffix}.`,
    data: { type: "new_tours_published" },
  });
}

module.exports = {
  notifyTourPaid,
  notifyNewToursPublished,
};
