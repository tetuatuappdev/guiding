const PDFDocument = require("pdfkit");

module.exports = function makeToursRoutes(supabaseAdmin, requireAdmin) {
  const router = require("express").Router();

  router.get("/ping", (req, res) => res.send("pong"));
  
  router.get("/:slotId/invoice-url", requireAdmin, async (req, res) => {
  try {
    const slotId = req.params.slotId;

    const { data: inv, error: iErr } = await supabaseAdmin
      .from("tour_invoices")
      .select("pdf_path")
      .eq("slot_id", slotId)
      .single();

    if (iErr) return res.status(404).json({ error: "Invoice not found" });

    // Normalise legacy paths (avoid invoices/invoices/... mess)
    let path = String(inv.pdf_path || "");
    while (path.startsWith("invoices/")) path = path.slice("invoices/".length);

    // Try current path, then fallback to known legacy layout if needed
    const trySign = async (p) =>
      supabaseAdmin.storage.from("invoices").createSignedUrl(p, 120);

    let { data, error } = await trySign(path);
    if (error) {
      const legacy = `${slotId}/invoices/invoice-${slotId}.pdf`;
      ({ data, error } = await trySign(legacy));
      if (error) {
        return res.status(404).json({ error: error.message, path, legacy });
      }
    }

    return res.json({ url: data.signedUrl, path });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});


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
  .select("id, name, bank_sort_code, bank_account_number, bank_payee_name, bank_email")
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
      const pdfBuffer = await buildInvoicePdfBuffer({
  invoiceNo: `INV-${slotId.slice(0, 8)}`,
  guideName: guide.name,
  clientName: "Marketing Cheshire",
  invoiceDateISO: slot.slot_date,
  bookingRef: "",
  tourLabel: "Chester Tour",
  personsTotal,
  grossPence,
  vicCommissionPence,
  totalPayablePence,
  bankPayeeName: guide.bank_payee_name,
  bankSortCode: guide.bank_sort_code,
  bankAccountNumber: guide.bank_account_number,
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

function buildInvoicePdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 60 });

      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const money = (pence) => `£${(Number(pence || 0) / 100).toFixed(0)}`; // example shows no decimals
      const dateFmt = (iso) => {
        // expects YYYY-MM-DD
        const d = new Date(iso + "T00:00:00Z");
        const day = d.getUTCDate();
        const suffix =
          day % 10 === 1 && day !== 11 ? "st" :
          day % 10 === 2 && day !== 12 ? "nd" :
          day % 10 === 3 && day !== 13 ? "rd" : "th";
        const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        return `${day}${suffix} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      };

      // --- Header ---
      doc.font("Helvetica-Bold").fontSize(18).text("INVOICE", { align: "left" });
      doc.font("Helvetica").fontSize(10).fillColor("#000");
doc.text(`Invoice reference: ${payload.invoiceNo}`);
doc.moveDown(0.8);
      doc.moveDown(1.2);

      // Guide block (matches example)
      doc.font("Helvetica-Bold").fontSize(12).text(payload.guideName || "—");
      doc.font("Helvetica").fontSize(10).text("Registered Green Badge Tourist Guide");
      doc.moveDown(1.2);

      // TO:
      doc.font("Helvetica-Bold").fontSize(10).text(`TO: ${payload.clientName || "Marketing Cheshire"}`);
      doc.moveDown(1.6);

      // --- Table header: Date | Booking Reference | Fee ---
      const x0 = doc.page.margins.left;
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const col1 = x0;
      const col2 = x0 + pageW * 0.33;
      const col3 = x0 + pageW * 0.78;

      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Date", col1);
      doc.text("Booking Reference", col2);
      doc.text("Fee", col3, undefined, { align: "right", width: pageW * 0.22 });

      doc.moveDown(0.8);
      doc.font("Helvetica").fontSize(10);

      // Row: Date + Booking Ref (fee blank like example)
      doc.text(dateFmt(payload.invoiceDateISO), col1);
      doc.text(payload.bookingRef || "", col2);
      // keep fee column empty on this row to match example spacing
      doc.text("", col3, undefined, { align: "right", width: pageW * 0.22 });

      doc.moveDown(1.2);

      // Line: Chester Tour - X visitors  £YYY
      doc.text(`${payload.tourLabel || "Chester Tour"} - ${payload.personsTotal} visitors`, col2);
      doc.text(money(payload.grossPence), col3, undefined, { align: "right", width: pageW * 0.22 });

      // Line: VIC Commission  -£ZZZ
      doc.moveDown(0.4);
      doc.text("VIC Commission", col2);
      doc.text(`-${money(payload.vicCommissionPence)}`, col3, undefined, { align: "right", width: pageW * 0.22 });

      doc.moveDown(1.0);

      // TOTAL PAYABLE £...
      doc.font("Helvetica-Bold").fontSize(12);
      doc.text("TOTAL PAYABLE", col2);
      doc.text(money(payload.totalPayablePence), col3, undefined, { align: "right", width: pageW * 0.22 });

      doc.moveDown(1.6);

      // BACS line
      doc.font("Helvetica").fontSize(10);
      const payee = payload.bankPayeeName || payload.guideName || "—";
      const sort = payload.bankSortCode || "—";
      const acct = payload.bankAccountNumber || "—";
      const email = payload.bankEmail || "";

      const bacs = `BACS Payment: ${payee}  Sort code: ${sort}  Account: ${acct}${email ? `\n${email}` : ""}`;
      doc.text(bacs, { align: "left" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
