const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/requireAuth");
const { supabaseAdmin } = require("../supabaseAdmin");

// NOTE: Login should be done directly via Supabase in the mobile app.
// We keep this endpoint as a helpful error so old clients fail loudly.
router.post("/login", (_req, res) => {
  res.status(410).json({
    message:
      "Deprecated. Use Supabase auth from the mobile app (signInWithPassword) and call this API with Authorization: Bearer <token>.",
  });
});

// POST /api/guides/availability  (upsert)
router.post("/availability", requireAuth, async (req, res) => {
  const { guide_id, date, is_available } = req.body || {};

  const effectiveGuideId = guide_id || req.user.id;
  if (effectiveGuideId !== req.user.id) {
    return res.status(403).json({ error: "Cannot edit availability for another guide." });
  }
  if (!date) return res.status(400).json({ error: "Missing date" });

  const payload = {
    guide_id: effectiveGuideId,
    date,
    is_available: !!is_available,
  };

  const { error } = await supabaseAdmin
    .from("availability")
    .upsert(payload, { onConflict: "guide_id,date" });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Availability updated" });
});

// GET /api/guides/:id/availability?month=YYYY-MM
router.get("/:id/availability", requireAuth, async (req, res) => {
  const guide_id = req.params.id;
  const { month } = req.query;

  if (guide_id !== req.user.id) {
    return res.status(403).json({ error: "Cannot read availability for another guide." });
  }

  let q = supabaseAdmin.from("availability").select("*").eq("guide_id", guide_id);

  if (month) {
    // month format: YYYY-MM; filter date between month start and next month start
    const start = `${month}-01`;
    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    if (!y || !m) return res.status(400).json({ error: "Invalid month format. Use YYYY-MM." });

    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    q = q.gte("date", start).lt("date", nextMonth);
  }

  const { data, error } = await q.order("date", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/guides/:id/history
router.get("/:id/history", requireAuth, async (req, res) => {
  const guide_id = req.params.id;
  if (guide_id !== req.user.id) {
    return res.status(403).json({ error: "Cannot read history for another guide." });
  }

  // Completed tours + ticket count (scanned)
  const { data: tours, error: toursErr } = await supabaseAdmin
    .from("tours")
    .select("id,name,tour_date,tour_time,status,participant_count_reported")
    .eq("guide_id", guide_id)
    .eq("status", "completed")
    .order("tour_date", { ascending: true })
    .order("tour_time", { ascending: true });

  if (toursErr) return res.status(500).json({ error: toursErr.message });

  const tourIds = (tours || []).map((t) => t.id);
  let scannedMap = {};
  if (tourIds.length) {
    const { data: tickets, error: tErr } = await supabaseAdmin
      .from("tickets")
      .select("tour_id, is_scanned")
      .in("tour_id", tourIds);

    if (tErr) return res.status(500).json({ error: tErr.message });

    scannedMap = (tickets || []).reduce((acc, t) => {
      if (!t.tour_id) return acc;
      acc[t.tour_id] = (acc[t.tour_id] || 0) + (t.is_scanned ? 1 : 0);
      return acc;
    }, {});
  }

  const enriched = (tours || []).map((t) => ({
    ...t,
    tickets_scanned: scannedMap[t.id] || 0,
  }));

  res.json(enriched);
});

module.exports = router;
