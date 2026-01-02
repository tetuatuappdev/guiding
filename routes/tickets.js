const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/requireAuth");
const { supabaseAdmin } = require("../supabaseAdmin");

// Helper: parse VIC prefix format and return { code, personCount }
function parseTicketCode(raw) {
  let code = String(raw || "");
  let personCount = 1;

  const vicPrefix = "Chester walking tour sold by VIC - ";
  if (!code.startsWith(vicPrefix)) return { code, personCount };

  let content = code.replace(vicPrefix, "");
  const personMatch = content.match(/^(\d+)\s+person(?:\(s\)|s)?\s+-\s+reference\s+#(\d+)$/i);
  const simpleMatch = content.match(/^reference\s+#(\d+)$/i);

  if (personMatch) {
    personCount = parseInt(personMatch[1], 10);
    code = personMatch[2];
  } else if (simpleMatch) {
    code = simpleMatch[1];
  } else {
    code = content; // fallback
  }
  return { code, personCount };
}

// POST /api/tickets/scan
router.post("/scan", requireAuth, async (req, res) => {
  const { code: rawCode, tour_id } = req.body || {};
  const tourId = Number(tour_id);

  if (!rawCode) return res.status(400).json({ valid: false, message: "Missing code" });
  if (!Number.isFinite(tourId)) return res.status(400).json({ valid: false, message: "Invalid tour_id" });

  // Ensure tour belongs to this guide
  const { data: tour, error: tourErr } = await supabaseAdmin
    .from("tours")
    .select("id,guide_id")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return res.status(500).json({ error: tourErr.message });
  if (!tour) return res.status(404).json({ valid: false, message: "Tour not found" });
  if (tour.guide_id !== req.user.id) return res.status(403).json({ valid: false, message: "Forbidden" });

  const { code, personCount } = parseTicketCode(rawCode);

  // Look up ticket
  const { data: ticket, error: getErr } = await supabaseAdmin
    .from("tickets")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (getErr) return res.status(500).json({ error: getErr.message });

  // Auto-create if not found (keeps previous behaviour for VIC/testing)
  if (!ticket) {
    const newTicket = {
      code,
      tourist_name: `VIC Tourist (Groups of ${personCount})`,
      is_scanned: true,
      tour_id: tourId,
    };

    const { data: created, error: insErr } = await supabaseAdmin
      .from("tickets")
      .insert(newTicket)
      .select("*")
      .single();

    if (insErr) return res.status(500).json({ error: insErr.message });

    return res.json({
      valid: true,
      message: "Ticket scanned successfully (Auto-verified)",
      ticket: created,
      personCount,
    });
  }

  if (ticket.is_scanned) {
    return res.status(400).json({ valid: false, message: "Ticket already scanned" });
  }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from("tickets")
    .update({ is_scanned: true, tour_id: tourId })
    .eq("id", ticket.id)
    .select("*")
    .single();

  if (upErr) return res.status(500).json({ error: upErr.message });

  return res.json({
    valid: true,
    message: "Ticket scanned successfully",
    ticket: updated,
    personCount,
  });
});

// POST /api/tickets/seed  (dev utility)
router.post("/seed", requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Missing code" });

  const { data, error } = await supabaseAdmin
    .from("tickets")
    .insert({ code, is_scanned: false })
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Ticket created", id: data.id });
});

// POST /api/tickets/reset (dev utility)
router.post("/reset", requireAuth, async (_req, res) => {
  const { error } = await supabaseAdmin
    .from("tickets")
    .update({ is_scanned: false, tour_id: null })
    .neq("id", 0); // update all

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "All tickets reset." });
});

module.exports = router;
