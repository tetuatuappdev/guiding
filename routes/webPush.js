const express = require("express");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.post("/subscribe", requireAuth, async (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription" });
  }

  const payload = {
    user_id: req.user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: req.headers["user-agent"] || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("web_push_subscriptions")
    .upsert(payload, { onConflict: "endpoint" });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ ok: true });
});

module.exports = { webPushRouter: router };
