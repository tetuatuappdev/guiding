const express = require("express");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { requireAuth } = require("../middleware/requireAuth");

const pushRouter = express.Router();

pushRouter.post("/register", requireAuth, async (req, res) => {
  const userId = req.user && req.user.id;
  const { expoPushToken, platform } = req.body || {};

  if (!userId) return res.status(401).json({ error: "unauthorized" });
  if (!expoPushToken) return res.status(400).json({ error: "missing expoPushToken" });

  const { error } = await supabaseAdmin.from("push_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform: platform || null,
      last_seen: new Date().toISOString(),
    },
    { onConflict: "expo_push_token" }
  );

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

module.exports = { pushRouter };
