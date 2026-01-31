const { notifyTourReminder } = require("./notifications");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

const getLocalParts = (date, timeZone) => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
};

async function sendTomorrowReminders(supabaseAdmin, timeZone) {
  const now = new Date();
  const today = getLocalParts(now, timeZone);
  const tomorrow = getLocalParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);

  const { data: slots, error: slotsErr } = await supabaseAdmin
    .from("schedule_slots")
    .select("id, slot_date, slot_time, guide_id, status")
    .eq("slot_date", tomorrow.date)
    .not("guide_id", "is", null)
    .in("status", ["planned", "scheduled"]);

  if (slotsErr) {
    console.error("tourReminders: failed to load slots", slotsErr);
    return { slotsCount: 0, usersNotified: 0 };
  }

  if (!slots || slots.length === 0) return { slotsCount: 0, usersNotified: 0 };

  const guideIds = Array.from(new Set(slots.map((s) => s.guide_id).filter(Boolean)));
  if (guideIds.length === 0) return { slotsCount: slots.length, usersNotified: 0 };

  const { data: guides, error: gErr } = await supabaseAdmin
    .from("guides")
    .select("id, user_id, first_name, last_name")
    .in("id", guideIds);

  if (gErr) {
    console.error("tourReminders: failed to load guides", gErr);
    return { slotsCount: slots.length, usersNotified: 0 };
  }

  const userByGuideId = new Map((guides || []).map((g) => [g.id, g.user_id]));

  const timesByUserId = new Map();
  (slots || []).forEach((slot) => {
    const userId = userByGuideId.get(slot.guide_id);
    if (!userId) return;
    const time = String(slot.slot_time || "").slice(0, 5);
    if (!time) return;
    const list = timesByUserId.get(userId) ?? [];
    list.push(time);
    timesByUserId.set(userId, list);
  });

  let usersNotified = 0;
  for (const [userId, times] of timesByUserId.entries()) {
    const uniqueTimes = Array.from(new Set(times)).sort();
    if (!uniqueTimes.length) continue;
    await notifyTourReminder({
      guideUserId: userId,
      times: uniqueTimes,
      date: tomorrow.date,
    });
    usersNotified += 1;
  }

  return { slotsCount: slots.length, usersNotified };
}

function startTourReminderWorker(supabaseAdmin, intervalMs = DEFAULT_INTERVAL_MS) {
  const timeZone = process.env.APP_TIMEZONE || "Europe/London";
  let lastRunDate = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const nowParts = getLocalParts(new Date(), timeZone);
      const isNoonWindow = nowParts.hour === 12 && nowParts.minute < 10;
      if (!isNoonWindow || lastRunDate === nowParts.date) {
        return;
      }
      await sendTomorrowReminders(supabaseAdmin, timeZone);
      lastRunDate = nowParts.date;
    } catch (err) {
      console.error("tourReminders: unexpected error", err);
    } finally {
      running = false;
    }
  };

  tick();
  setInterval(tick, intervalMs).unref?.();
}

module.exports = { startTourReminderWorker, sendTomorrowReminders };
