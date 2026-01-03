require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use("/public", express.static("public"));

// --- Supabase admin client (SERVER ONLY) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. /api/auth/invite will fail."
  );
}

console.log("SUPABASE_URL set:", !!SUPABASE_URL);
console.log("SERVICE_ROLE set:", !!SUPABASE_SERVICE_ROLE_KEY);
console.log("SERVICE_ROLE looks like service:", (SUPABASE_SERVICE_ROLE_KEY || "").startsWith("eyJ"));


const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

async function requireAdmin(req, res, next) {
  try {
    if (!supabaseAdmin) return res.status(500).json({ error: "Supabase admin not configured" });

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const { data: userData, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !userData?.user) return res.status(401).json({ error: "Invalid token" });

    const uid = userData.user.id;

    const { data: adminRow, error: aErr } = await supabaseAdmin
  .from("admins")
  .select("user_id")
  .eq("user_id", uid)
  .maybeSingle();

if (aErr) return res.status(500).json({ error: "Admin check failed" });
if (!adminRow) return res.status(403).json({ error: "Forbidden" });
    req.user = userData.user;
    next();
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}

const makeAdminRoutes = require("./routes/admin");
app.use("/api/admin", makeAdminRoutes(supabaseAdmin, requireAdmin));


// Keep Render awake (UptimeRobot can ping with HEAD)
app.head("/keepitwarm", (_req, res) => {
  res.status(200).end();
});

// Useful if you test in a browser too
app.get("/keepitwarm", (_req, res) => {
  res.status(200).send("ok");
});

// --- AUTH: Invite-only signup (whitelist) ---
app.post("/api/auth/invite", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Supabase admin not configured" });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    // 1) check whitelist
    const { data: allowed, error: werr } = await supabaseAdmin
      .from("admin_whitelist")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (werr) {
      return res.status(500).json({ error: "Whitelist query failed" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // 2) send invite email (user sets password via link)
    // change this to your real page
    const redirectTo = "https://guiding.onrender.com/set-password";

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo }
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, userId: data?.user?.id ?? null });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

// Routes
const guidesRoutes = require("./routes/guides");
const toursRoutes = require("./routes/tours");
const ticketsRoutes = require("./routes/tickets");

app.use("/api/guides", guidesRoutes);
app.use("/api/tours", toursRoutes);
app.use("/api/tickets", ticketsRoutes);

// Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "guiding-backend" });
});

app.get("/", (_req, res) => {
  res.send("Guiding Tour API (Supabase) is running");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});

app.get("/reset-password", (req, res) => {
  // Supabase va appeler cette URL avec des params dans l’URL (token / code etc)
  const qs = req.url.includes("?") ? req.url.split("?")[1] : "";
  // Renvoie vers un lien "app" géré par Expo Router via Linking
  // On utilise un custom scheme "guiding://"
  const appLink = `guiding://reset-password?${qs}`;

  res.status(302).set("Location", appLink).send("Redirecting…");
});
