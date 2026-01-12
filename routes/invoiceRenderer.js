const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(vars[k]));
}

function prettyDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11 ? "st" :
    day % 10 === 2 && day !== 12 ? "nd" :
    day % 10 === 3 && day !== 13 ? "rd" : "th";
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${day}${suffix} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function moneyGBP(pence) {
  const v = (Number(pence || 0) / 100);
  // ton exemple est sans décimales, garde ça
  return `£${v.toFixed(0)}`;
}

async function renderInvoicePdfBuffer(payload) {
  const tplPath = path.join(__dirname, "..", "invoices", "invoice.html");
  const tpl = fs.readFileSync(tplPath, "utf8");

  const html = fillTemplate(tpl, {
    invoiceNo: payload.invoiceNo || "",
    guideFirstName: payload.guideFirstName,
    guideLastName: payload.guideLastName,
    clientName: payload.clientName || "Marketing Cheshire",
    bookingRef: payload.bookingRef || "",
    tourLabel: payload.tourLabel || "Chester Tour",
    personsTotal: String(payload.personsTotal ?? 0),
    prettyDate: prettyDate(payload.invoiceDateISO),
    gross: moneyGBP(payload.grossPence),
    vicCommission: `-${moneyGBP(payload.vicCommissionPence)}`,
    total: moneyGBP(payload.totalPayablePence),
    pricePerPerson: moneyGBP(payload.price_per_person_gbp),
    CommisionPct: payload.CommisionPct,
    bankPayeeName: payload.bankPayeeName || payload.guideName || "—",
    bankSortCode: payload.bankSortCode || "—",
    bankAccountNumber: payload.bankAccountNumber || "—",
    bankEmail: payload.bankEmail || "",
  });

  console.log("PW browsers path:", process.env.PLAYWRIGHT_BROWSERS_PATH);

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

module.exports = { renderInvoicePdfBuffer };
