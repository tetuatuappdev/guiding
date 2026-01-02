require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use("/public", express.static("public"));

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
