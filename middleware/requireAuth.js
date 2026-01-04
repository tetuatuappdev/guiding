const { supabaseAuth } = require("../supabaseAdmin");


async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = m && m[1];

    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = data.user; // { id, email, ... }
    next();
  } catch (e) {
    return res.status(500).json({ error: "Auth middleware failed" });
  }
}

module.exports = { requireAuth };
