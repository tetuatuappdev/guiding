const express = require("express");
const PDFDocument = require("pdfkit");

module.exports = function makeAdminRoutes(supabaseAdmin, requireAdmin) {
  const router = express.Router();

  router.post("/tours/:slotId/mark-paid", requireAdmin, async (req, res) => {
    try {
      if (!supabaseAdmin) return res.status(500).json({ error: "Supabase admin not configured" });

      const slotId = req.params.slotId;
      const { currency = "GBP", amount_pence = null, fees_pence = 0 } = req.body || {};

      // 1) slot info
      const { data: slot, error: sErr } = await supabaseAdmin
        .from("schedule_slots")
        .select("id, slot_date, slot_time, guide_id")
        .eq("id", slotId)
        .single();

      if (sErr) return res.status(404).json({ error: "Slot not found" });
      if (!slot.guide_id) return res.status(400).json({ error: "Slot has no guide" });

      // 2) guide name
      const { data: guide, error: gErr } = await supabaseAdmin
        .from("guides_public")
        .select("id, name")
        .eq("id", slot.guide_id)
        .single();

      if (gErr) return res.status(500).json({ error: "Failed to load guide" });

      // 3) ticket totals
      const { data: scans, error: tErr } = await supabaseAdmin
        .from("ticket_scans")
        .select("persons, kind")
        .eq("slot_id", slotId);

      if (tErr) return res.status(500).json({ error: "Failed to load tickets" });

      const personsTotal = (scans || []).reduce((acc, r) => acc + (r.persons ?? 1), 0);
      const vicPersons = (scans || []).filter(r => r.kind !== "online").reduce((a, r) => a + (r.persons ?? 1), 0);
      const onlinePersons = (scans || []).filter(r => r.kind === "online").reduce((a, r) => a + (r.persons ?? 1), 0);

      // 4) decide amounts
      // amount_pence could be passed from UI, or computed. Keep it explicit for now.
      const totalPence = amount_pence;
      const feesPence = Number(fees_pence || 0);
      const netPence = totalPence != null ? Math.max(0, Number(totalPence) - feesPence) : null;

      // 5) build PDF buffer
      const pdfBuffer = await buildInvoicePdfBuffer({
        invoiceNo: `INV-${slotId.slice(0, 8)}`,
        guideName: guide?.name ?? "Unknown",
        slotDate: slot.slot_date,
        slotTime: String(slot.slot_time || "").slice(0, 5),
        personsTotal,
        vicPersons,
        onlinePersons,
        currency,
        totalPence,
        feesPence,
        netPence,
      });

      // 6) upload to storage (private bucket)
      const path = `invoices/${slotId}/invoice-${slotId}.pdf`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("invoices")
        .upload(path, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (upErr) return res.status(500).json({ error: "Failed to upload PDF" });

      // 7) upsert invoice row
      const { error: iErr } = await supabaseAdmin
        .from("tour_invoices")
        .upsert(
          {
            slot_id: slotId,
            guide_id: slot.guide_id,
            pdf_path: path,
            amount_pence: totalPence,
            currency,
            persons: personsTotal,
          },
          { onConflict: "slot_id" }
        );

      if (iErr) return res.status(500).json({ error: "Failed to write tour_invoices" });

      // 8) update payment status
      const { error: pErr } = await supabaseAdmin
        .from("tour_payments")
        .upsert(
          { slot_id: slotId, status: "paid", amount_pence: totalPence, currency },
          { onConflict: "slot_id" }
        );

      if (pErr) return res.status(500).json({ error: "Failed to update tour_payments" });

      return res.json({
        ok: true,
        slotId,
        pdf_path: path,
        personsTotal,
        vicPersons,
        onlinePersons,
      });
    } catch (e) {
      console.log("mark-paid failed", e);
      return res.status(500).json({ error: "Server error" });
    }
  });

  return router;
};

function buildInvoicePdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });

      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(20).text("Invoice", { align: "left" });
      doc.moveDown(0.5);

      doc.fontSize(10).fillColor("#444");
      doc.text(`Invoice No: ${payload.invoiceNo}`);
      doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`);
      doc.moveDown(1);

      doc.fillColor("#000").fontSize(12);
      doc.text(`Guide: ${payload.guideName}`);
      doc.text(`Tour: ${payload.slotDate} @ ${payload.slotTime}`);
      doc.moveDown(1);

      doc.fontSize(12).text("Attendance");
      doc.fontSize(11).text(`Total persons: ${payload.personsTotal}`);
      doc.text(`VIC persons: ${payload.vicPersons}`);
      doc.text(`Online persons: ${payload.onlinePersons}`);
      doc.moveDown(1);

      doc.fontSize(12).text("Payment");
      const fmt = (p) => (p == null ? "—" : `${(p / 100).toFixed(2)} ${payload.currency}`);
      doc.fontSize(11).text(`Total: ${fmt(payload.totalPence)}`);
      doc.text(`Fees: ${fmt(payload.feesPence)}`);
      doc.text(`Net: ${fmt(payload.netPence)}`);

      doc.moveDown(2);
      doc.fontSize(9).fillColor("#666").text("Generated automatically by Guiding.", { align: "left" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = function makeAdminRoutes(supabaseAdmin, requireAdmin) {
  const router = express.Router();

  router.post("/tours/:slotId/mark-paid", requireAdmin, async (req, res) => {
    // tout le code invoice ici
  });

  return router;
};

