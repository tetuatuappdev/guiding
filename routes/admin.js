const PDFDocument = require("pdfkit");
const { renderInvoicePdfBuffer } = require("./invoiceRenderer");
import { notifyTourPaid } from "../services/notifications";


module.exports = function makeToursRoutes(supabaseAdmin, requireAdmin) {
  const router = require("express").Router();

  router.get("/ping", (req, res) => res.send("pong"));
  

  router.post("/:slotId/mark-paid", requireAdmin, async (req, res) => {
    console.log("mark-paid: start", req.params.slotId);

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
  .from("guides")
  .select("id, first_name, last_name, sort_code, account_number, bank_payee_name, bank_email")
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

      const { data: cfgRows, error: cfgErr } = await supabaseAdmin
  .from("configuration")
  .select("key, value_numeric");

if (cfgErr) {
  return res.status(500).json({ error: "Failed to load configuration" });
}

const cfg = Object.fromEntries(
  (cfgRows || []).map(r => [r.key, Number(r.value_numeric)])
);

const PRICE_PER_PERSON_PENCE = Math.round(cfg.price_per_person_gbp * 100);
const VIC_COMMISSION_PER_PERSON_PENCE = Math.round(cfg.vic_commission_per_person_gbp * 100);


      // 4) decide amounts
      // amount_pence could be passed from UI, or computed. Keep it explicit for now.
      const totalPence = amount_pence;
      const feesPence = Number(fees_pence || 0);
      const netPence = totalPence != null ? Math.max(0, Number(totalPence) - feesPence) : null;
      const grossPence = personsTotal * PRICE_PER_PERSON_PENCE;
const vicCommissionPence = vicPersons * VIC_COMMISSION_PER_PERSON_PENCE;
const totalPayablePence = grossPence - vicCommissionPence;


      // 5) build PDF buffer
      const pdfBuffer = await renderInvoicePdfBuffer({
  invoiceNo: `INV-${slotId.slice(0, 8)}`,
  guideFirstName: guide.first_name,
  guideLastName: guide.last_name,
  clientName: "Marketing Cheshire",
  invoiceDateISO: slot.slot_date,
  bookingRef: "",
  tourLabel: "Chester Tour",
  personsTotal,
  grossPence,
  vicCommissionPence,
  totalPayablePence,
  bankPayeeName: guide.bank_payee_name,
  bankSortCode: guide.sort_code,
  bankAccountNumber: guide.account_number,
  bankEmail: guide.bank_email,
});

      // 6) upload to storage (private bucket)
      const path = `${slotId}/invoice-${slotId}.pdf`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("invoices")
        .upload(path, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (upErr) {
  console.error("PDF upload error:", upErr);
  return res.status(500).json({ error: "Failed to upload PDF", details: upErr.message });
}

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
    {
      slot_id: slotId,
      guide_id: slot.guide_id,
      status: "paid",
      amount_pence: totalPayablePence,
      currency: "GBP",
    },
    { onConflict: "slot_id" }
  );


      if (pErr) {
  console.error("tour_payments upsert error:", pErr);
  return res.status(500).json({ error: "Failed to update tour_payments", details: pErr.message });
}

await notifyTourPaid({
  guideUserId: guideId,   // celui du slot
  slotId,
  amount,
  currency: "€",
});


      return res.json({
        ok: true,
        slotId,
        pdf_path: path,
        personsTotal,
        vicPersons,
        onlinePersons,
      });
    } catch (e) {
  console.error("mark-paid failed", e);
  return res.status(500).json({
    error: "Server error",
    details: e?.message || String(e),
    stack: process.env.NODE_ENV === "production" ? undefined : e?.stack,
  });
}
  });

  return router;
};

