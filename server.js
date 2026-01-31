require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const { requireAuth } = require("./middleware/requireAuth");

const { pushRouter } = require("./routes/push");
const { webPushRouter } = require("./routes/webPush");
const { startTourCompletionWorker } = require("./services/tourCompletion");
const { startTourReminderWorker, sendTomorrowReminders } = require("./services/tourReminders");
app.use(cors({ origin: true }));
app.use(express.json());
app.use("/api/push", pushRouter);
app.use("/api/web-push", webPushRouter);
app.use("/public", express.static("public"));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "Chester Tours <onboarding@resend.dev>";
const PLAY_STORE_URL =
  process.env.PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.chestertours.app";
const APP_STORE_URL = process.env.APP_STORE_URL || "";

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  console.warn("Missing Supabase env vars (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY)");
}

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabaseService = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normEmail(x) {
  return String(x || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return !!email && email.includes("@") && email.length <= 254;
}

async function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Invalid token" });

    req.user = data.user;
    next();
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}

async function sendDownloadEmail(to) {
  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY (mail sending disabled)");

  const html = `
    <h2>Chester Walking Tours</h2>
    <p>Your email has been authorised. Next step: install the app.</p>
    <p><a href="${PLAY_STORE_URL}">Download on Google Play</a></p>
    ${APP_STORE_URL ? `<p><a href="${APP_STORE_URL}">Download on the App Store</a></p>` : ""}
    <p>Then sign up with <b>${to}</b>.</p>
    <p style="color:#666;font-size:12px">If you didn’t request this, ignore this email.</p>
  `;

  // Node 18+ has global fetch. Render is typically Node 18/20.
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject: "Install the app to create your account",
      html,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const { data: userData, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !userData?.user) return res.status(401).json({ error: "Invalid token" });

    const uid = userData.user.id;

    const { data: adminRow, error: aErr } = await supabaseService
      .from("admins")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (aErr) return res.status(500).json({ error: "Admin check failed" });
    if (!adminRow) return res.status(403).json({ error: "Forbidden" });

    req.user = userData.user;
    next();
  } catch (e) {
    console.error("requireAdmin failed", e);
    return res.status(500).json({ error: "Server error" });
  }
}

pushRouter.post("/test-admin", requireAdmin, async (req, res) => {
  // envoie à l’admin connecté, ou à tous les tokens, etc.
});

// Admin-only routes (payments / invoices, etc.)
const makeAdminRoutes = require("./routes/admin");
app.use("/api/admin/tours", makeAdminRoutes(supabaseService, requireAdmin));

// Keep Render awake
//app.head("/keepitwarm", (_req, res) => res.status(200).end());
app.get("/keepitwarm", (_req, res) => res.status(200).send("ok"));

app.head("/keepitwarm", (req, res) => {
  console.log("[HEAD keepitwarm]", new Date().toISOString());
  res.status(200).end();
});

app.post("/api/admin/reminders/tomorrow", requireAdmin, async (_req, res) => {
  try {
    const timeZone = process.env.APP_TIMEZONE || "Europe/London";
    const result = await sendTomorrowReminders(supabaseService, timeZone);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/admin/push/user", requireAdmin, async (req, res) => {
  const email = normEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email." });
  }

  try {
    const { supabaseAdmin } = require("./lib/supabaseAdmin");
    const adminAuth = supabaseAdmin.auth?.admin;
    if (!adminAuth) {
      return res.status(500).json({ ok: false, error: "Admin auth API unavailable." });
    }

    let user = null;
    if (typeof adminAuth.getUserByEmail === "function") {
      const { data, error } = await adminAuth.getUserByEmail(email);
      if (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
      user = data?.user ?? null;
    } else if (typeof adminAuth.listUsers === "function") {
      const { data, error } = await adminAuth.listUsers({ page: 1, perPage: 1000 });
      if (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
      const list = data?.users ?? [];
      user = list.find((u) => String(u.email || "").toLowerCase() === email) ?? null;
    }

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found." });
    }

    const userId = user.id;
    const { sendExpoPush } = require("./lib/expoPush");
    const { sendWebPush } = require("./lib/webPush");

    const { data: expoRows } = await supabaseAdmin
      .from("push_tokens")
      .select("expo_push_token")
      .eq("user_id", userId);

    const expoTokens = (expoRows || [])
      .map((r) => r.expo_push_token)
      .filter(Boolean);

    const { data: webRows } = await supabaseAdmin
      .from("web_push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);

    const payload = {
      title: "Test notification",
      body: "Test push sent from admin.",
      data: { type: "admin_test" },
    };

    const webResult = await sendWebPush(webRows || [], payload);
    const expoResult = await sendExpoPush(expoTokens, payload);

    return res.json({
      ok: true,
      expo: { tokens: expoTokens.length, result: expoResult },
      web: { subs: (webRows || []).length, result: webResult },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * AUTH (allowlist-driven)
 *
 * 1) /api/auth/invite -> sends only a "download the app" email (no Auth user creation)
 * 2) /api/auth/check-allowlist -> UX check
 * 3) /api/auth/signup -> server-side account creation (hard gate)
 */

// 1) Send email with Store links (no auth creation)
app.post("/api/auth/invite", async (req, res) => {
  const email = normEmail(req.body?.email);
  console.log("[INVITE] hit", { email });

  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });

  const { data: allowed, error: werr } = await supabaseService
    .from("invite_allowlist")
    .select("id,email,role")
    .eq("email", email)
    .maybeSingle();

  if (werr) return res.status(500).json({ error: "Allowlist query failed" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  try {
    const out = await sendDownloadEmail(email);

    await supabaseService
      .from("invite_allowlist")
      .update({ invited_at: new Date().toISOString() })
      .eq("id", allowed.id);

    console.log("[INVITE] download email sent", { id: out?.id, email });
    return res.json({ ok: true });
  } catch (e) {
    console.log("[INVITE] email send failed", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// 2) Simple allowlist check (for UX)
app.post("/api/auth/check-allowlist", async (req, res) => {
  const email = normEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ allowed: false });

  const { data, error } = await supabaseService
    .from("invite_allowlist")
    .select("id,role")
    .eq("email", email)
    .maybeSingle();

  if (error) return res.status(500).json({ allowed: false });
  return res.json({ allowed: !!data, role: data?.role ?? null });
});

// 3) HARD-GATED signup (server creates auth user)
app.post("/api/auth/signup", async (req, res) => {
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  // allowlist check
  const { data: allowed, error: werr } = await supabaseService
    .from("invite_allowlist")
    .select("id,email,role")
    .eq("email", email)
    .maybeSingle();

  if (werr) return res.status(500).json({ error: werr.message, details: werr });
  if (!allowed) return res.status(403).json({ error: "Not authorised" });

  // optional: one-time use
  // if (allowed.used_at) return res.status(409).json({ error: "Email already used" });

  // create auth user
  try {
    const { data, error } = await supabaseService.auth.admin.createUser({
      email,
      password,
      // choose your policy:
      email_confirm: true, // set true if you want NO email verification friction
    });

    if (error) {
      // common case: already exists
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
        return res.status(409).json({ error: "Email already registered" });
      }
      return res.status(500).json({ error: msg });
    }

    // mark allowlist used
    await supabaseService
      .from("invite_allowlist")
      .update({ used_at: new Date().toISOString() })
      .eq("id", allowed.id);

    return res.json({ ok: true, userId: data?.user?.id ?? null });
  } catch (e) {
    console.error("[SIGNUP] failed", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// App routes
const guidesRoutes = require("./routes/guides");
const toursRoutes = require("./routes/tours");
const ticketsRoutes = require("./routes/tickets");
app.use("/api/guides", guidesRoutes);
app.use("/api/tours", toursRoutes(supabaseService, requireUser, requireAuth));

// Auto-complete past tours + enqueue pending payments (paper/scanned tickets only).
startTourCompletionWorker(supabaseService);
// Daily noon reminder for tomorrow's tours.
startTourReminderWorker(supabaseService);
app.use("/api/tickets", ticketsRoutes);

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "guiding-backend" }));
app.get("/", (_req, res) => res.send("Guiding Tour API (Supabase) is running"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
