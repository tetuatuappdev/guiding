const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY; // sb_publishable_...
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;           // sb_secret_...

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY or SUPABASE_SECRET_KEY");
}

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabaseService = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Backwards-compatible alias (some routes still import supabaseAdmin)
const supabaseAdmin = supabaseService;

module.exports = { supabaseAuth, supabaseService, supabaseAdmin };
