const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

const buildSlotTimestamp = (slotDate, slotTime) => {
  if (!slotDate) return NaN;
  const time = slotTime && String(slotTime).trim() ? slotTime : "00:00:00";
  return new Date(`${slotDate}T${time}`).getTime();
};

async function syncCompletedToursAndPayments(supabaseAdmin) {
  if (!supabaseAdmin) return;

  const cutoffMs = Date.now() - TWO_HOURS_MS;
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: slots, error: slotsErr } = await supabaseAdmin
    .from("schedule_slots")
    .select("id, slot_date, slot_time, status, guide_id")
    .not("guide_id", "is", null)
    .lte("slot_date", todayIso);

  if (slotsErr) {
    console.error("tourCompletion: failed to load slots", slotsErr);
    return;
  }

  const pastSlots = (slots || []).filter((s) => {
    const ts = buildSlotTimestamp(s.slot_date, s.slot_time);
    return Number.isFinite(ts) && ts <= cutoffMs;
  });

  if (pastSlots.length === 0) return;

  const toCompleteIds = pastSlots
    .filter((s) => s.status !== "completed")
    .map((s) => s.id);

  if (toCompleteIds.length) {
    const { error: updErr } = await supabaseAdmin
      .from("schedule_slots")
      .update({ status: "completed" })
      .in("id", toCompleteIds);

    if (updErr) {
      console.error("tourCompletion: failed to update slot status", updErr);
    }
  }

  const slotIds = pastSlots.map((s) => s.id);

  const { data: scans, error: scanErr } = await supabaseAdmin
    .from("ticket_scans")
    .select("slot_id, kind, persons")
    .in("slot_id", slotIds)
    .in("kind", ["paper", "scanned"]);

  if (scanErr) {
    console.error("tourCompletion: failed to load ticket scans", scanErr);
    return;
  }

  const vicPersonsBySlot = new Map();
  (scans || []).forEach((r) => {
    if (!r.slot_id) return;
    const current = vicPersonsBySlot.get(r.slot_id) ?? 0;
    vicPersonsBySlot.set(r.slot_id, current + (r.persons ?? 1));
  });

  const slotsWithTickets = new Set(vicPersonsBySlot.keys());

  if (slotsWithTickets.size === 0) return;

  const { data: cfgRows, error: cfgErr } = await supabaseAdmin
    .from("configuration")
    .select("key, value_numeric");

  if (cfgErr) {
    console.error("tourCompletion: failed to load configuration", cfgErr);
    return;
  }

  const cfg = Object.fromEntries(
    (cfgRows || []).map((r) => [r.key, Number(r.value_numeric)])
  );

  const PRICE_PER_PERSON_PENCE = Math.round(cfg.price_per_person_gbp * 100);
  const VIC_COMMISSION_PER_PERSON_PENCE = cfg.vic_commission_per_person_gbp;

  if (
    !Number.isFinite(PRICE_PER_PERSON_PENCE) ||
    !Number.isFinite(VIC_COMMISSION_PER_PERSON_PENCE)
  ) {
    console.error("tourCompletion: invalid pricing configuration", cfg);
    return;
  }

  const { data: payments, error: payErr } = await supabaseAdmin
    .from("tour_payments")
    .select("slot_id")
    .in("slot_id", Array.from(slotsWithTickets));

  if (payErr) {
    console.error("tourCompletion: failed to load tour payments", payErr);
    return;
  }

  const existingPayments = new Set(
    (payments || []).map((p) => p.slot_id).filter(Boolean)
  );

  const pendingRows = pastSlots
    .filter((s) => slotsWithTickets.has(s.id) && !existingPayments.has(s.id))
    .map((s) => {
      const vicPersons = vicPersonsBySlot.get(s.id) ?? 0;
      const grossPence = vicPersons * PRICE_PER_PERSON_PENCE;
      const vicCommissionPence = grossPence * VIC_COMMISSION_PER_PERSON_PENCE;
      const totalPayablePence = grossPence - vicCommissionPence;

      return {
        slot_id: s.id,
        guide_id: s.guide_id,
        status: "pending",
        amount_pence: totalPayablePence,
        currency: "GBP",
      };
    });

  if (pendingRows.length === 0) return;

  const { error: insErr } = await supabaseAdmin
    .from("tour_payments")
    .insert(pendingRows);

  if (insErr) {
    console.error("tourCompletion: failed to insert pending payments", insErr);
  }
}

function startTourCompletionWorker(supabaseAdmin, intervalMs = DEFAULT_INTERVAL_MS) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncCompletedToursAndPayments(supabaseAdmin);
    } catch (err) {
      console.error("tourCompletion: unexpected error", err);
    } finally {
      running = false;
    }
  };

  tick();
  setInterval(tick, intervalMs).unref?.();
}

module.exports = { startTourCompletionWorker };
