const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/requireAuth");
const { supabaseAdmin } = require("../supabaseAdmin");

// GET /api/tours/guide/me
router.get("/guide/me", requireAuth, async (req, res) => {
  const guide_id = req.user.id;

  const { data, error } = await supabaseAdmin
    .from("tours")
    .select("id,name,tour_date,tour_time,status,participant_count_reported")
    .eq("guide_id", guide_id)
    .order("tour_date", { ascending: true })
    .order("tour_time", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/tours/guide/:id  (kept for compatibility)
router.get("/guide/:id", requireAuth, async (req, res) => {
  const guide_id = req.params.id;
  if (guide_id !== req.user.id) {
    return res.status(403).json({ error: "Cannot read tours for another guide." });
  }

  const { data, error } = await supabaseAdmin
    .from("tours")
    .select("id,name,tour_date,tour_time,status,participant_count_reported")
    .eq("guide_id", guide_id)
    .order("tour_date", { ascending: true })
    .order("tour_time", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/tours/:id/submit
router.post("/:id/submit", requireAuth, async (req, res) => {
  const tour_id = Number(req.params.id);
  const { participant_count } = req.body || {};

  if (!Number.isFinite(tour_id)) return res.status(400).json({ error: "Invalid tour id" });
  if (!Number.isFinite(Number(participant_count))) {
    return res.status(400).json({ error: "participant_count must be a number" });
  }

  const { data, error } = await supabaseAdmin
    .from("tours")
    .update({
      status: "completed",
      participant_count_reported: Number(participant_count),
    })
    .eq("id", tour_id)
    .eq("guide_id", req.user.id)
    .select("id")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ message: "Tour not found" });

  res.json({ message: "Tour submitted successfully" });
});

// GET /api/tours/:id/tickets
router.get("/:id/tickets", requireAuth, async (req, res) => {
  const tour_id = Number(req.params.id);
  if (!Number.isFinite(tour_id)) return res.status(400).json({ error: "Invalid tour id" });

  // Ensure the tour belongs to this guide
  const { data: tour, error: tErr } = await supabaseAdmin
    .from("tours")
    .select("id,guide_id")
    .eq("id", tour_id)
    .maybeSingle();

  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!tour) return res.status(404).json({ error: "Tour not found" });
  if (tour.guide_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

  const { data, error } = await supabaseAdmin
    .from("tickets")
    .select("*")
    .eq("tour_id", tour_id)
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ tickets: data });
});

module.exports = router;
