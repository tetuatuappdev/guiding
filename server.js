require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use("/public", express.static("public"));

// Keep Render awake (UptimeRobot can ping with HEAD)
app.head("/keepitwarm", (_req, res) => {
  res.status(200).end();
});

// Useful if you test in a browser too
app.get("/keepitwarm", (_req, res) => {
  res.status(200).send("ok");
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

  res
    .status(302)
    .set("Location", appLink)
    .send("Redirecting…");
});

