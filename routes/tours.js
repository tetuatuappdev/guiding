console.log("tours middlewares", typeof requireUser, typeof requireAuth);


const express = require("express");

module.exports = (supabaseAdmin, requireUser, requireAuth) => {
  const router = express.Router();

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

  // GET /api/tours/:slotId/invoice-url  (GUIDE-ACCESS)
  router.get("/:slotId/invoice-url", requireUser, async (req, res) => {
    try {
      const slotId = req.params.slotId;
      const uid = req.user.id;

      const { data: slot, error: sErr } = await supabaseAdmin
        .from("schedule_slots")
        .select("id, guide_id")
        .eq("id", slotId)
        .single();

      if (sErr || !slot) return res.status(404).json({ error: "Slot not found" });
      if (slot.guide_id !== uid) return res.status(403).json({ error: "Forbidden" });

      const { data: inv, error: iErr } = await supabaseAdmin
        .from("tour_invoices")
        .select("pdf_path")
        .eq("slot_id", slotId)
        .single();

      if (iErr || !inv) return res.status(404).json({ error: "Invoice not found" });

      let path = String(inv.pdf_path || "");
      while (path.startsWith("invoices/")) path = path.slice("invoices/".length);

      // bucket public:
      const { data } = supabaseAdmin.storage.from("invoices").getPublicUrl(path);
      return res.json({ url: data.publicUrl, path });
    } catch (e) {
      return res.status(500).json({ error: "Server error" });
    }
  });

  // GET /api/tours/guide/:id (compat)
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

  return router;
};
