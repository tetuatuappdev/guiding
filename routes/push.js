const express = require("express");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { requireAuth } = require("../middleware/requireAuth");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();
const pushRouter = express.Router();

pushRouter.post("/register", requireAuth, async (req, res) => {
  const userId = req.user?.id;
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

  console.log("[PUSH] /register body =", req.body);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

pushRouter.post("/test", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("expo_push_token")
    .eq("user_id", userId)
    .order("last_seen", { ascending: false })
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });

  const token = data?.[0]?.expo_push_token;
  if (!token) return res.status(404).json({ error: "no token" });
  if (!Expo.isExpoPushToken(token)) return res.status(400).json({ error: "invalid token" });

  const messages = [{
    to: token,
    sound: "default",
    title: "Test push",
    body: "Si tu vois ça, c’est gagné.",
  }];

  try {
    const tickets = await expo.sendPushNotificationsAsync(messages);
    console.log("[PUSH] tickets =", tickets);
    return res.json({ ok: true, tickets });
  } catch (e) {
    console.error("[PUSH] error", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

module.exports = { pushRouter };
