import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.ts";
import { requireAuth } from "../middleware/requireAuth";

export const pushRouter = Router();

pushRouter.post("/register", requireAuth, async (req, res) => {
  const userId = req.user.id; // IMPORTANT: adapte si ton middleware expose autrement
  const { expoPushToken, platform } = req.body ?? {};

  if (!expoPushToken) return res.status(400).json({ error: "missing expoPushToken" });

  const { error } = await supabaseAdmin.from("push_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform: platform ?? null,
      last_seen: new Date().toISOString(),
    },
    { onConflict: "expo_push_token" }
  );

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
