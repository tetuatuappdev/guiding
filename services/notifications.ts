import { supabaseAdmin } from "../lib/supabaseAdmin.ts";
import { sendExpoPush } from "../lib/expoPush";

async function getTokensForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);

  if (error) throw error;
  return (data ?? []).map((r) => r.expo_push_token).filter(Boolean);
}

async function getTokensForUsers(userIds: string[]) {
  if (!userIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("expo_push_token")
    .in("user_id", userIds);

  if (error) throw error;
  return (data ?? []).map((r) => r.expo_push_token).filter(Boolean);
}

export async function notifyTourPaid(opts: {
  guideUserId: string;
  slotId: string;
  amount?: number;
  currency?: string;
}) {
  const tokens = await getTokensForUser(opts.guideUserId);
  const amountText =
    typeof opts.amount === "number" ? ` (${opts.amount}${opts.currency ?? "€"})` : "";

  return sendExpoPush(tokens, {
    title: "Tour payé ✅",
    body: `Ton tour a été marqué comme payé${amountText}.`,
    data: { type: "tour_paid", slotId: opts.slotId },
  });
}

export async function notifyNewToursPublished(opts: {
  guideUserIds: string[];
  monthLabel?: string;
  count?: number;
}) {
  const tokens = await getTokensForUsers(opts.guideUserIds);
  const when = opts.monthLabel ? ` pour ${opts.monthLabel}` : "";
  const suffix = opts.count ? ` (${opts.count} nouveaux créneaux)` : "";

  return sendExpoPush(tokens, {
    title: "Nouveaux tours publiés 📅",
    body: `De nouveaux tours sont disponibles${when}${suffix}.`,
    data: { type: "new_tours_published" },
  });
}
