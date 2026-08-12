/**
 * Verifies a real Supabase Auth session token (sent from the browser
 * after a real login via the Supabase JS SDK) and attaches a
 * per-request Supabase client authenticated AS that user - not the
 * service-role key. This means every query made through req.supabase
 * is subject to the exact RLS policies tested all session; this
 * middleware does not re-implement authorization, it just gets out of
 * RLS's way and lets it do the real work.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // safe to use client-side too - RLS is what protects data, not this key

if (!SUPABASE_ANON_KEY) {
  console.warn(
    'WARNING: SUPABASE_ANON_KEY is not set. Mission Control routes will fail until it is added to .env. ' +
    'This is the public anon key from Supabase > Project Settings > API - it is safe to expose, RLS is the real protection.'
  );
}

async function requireSupabaseAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, error: { message: 'Authentication required. Log in and retry.' } });
  }

  if (!SUPABASE_ANON_KEY) {
    return res.status(500).json({ success: false, error: { message: 'Server auth is not configured (missing SUPABASE_ANON_KEY).' } });
  }

  const supabaseAsUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser(token);

  if (userError || !userData || !userData.user) {
    return res.status(401).json({ success: false, error: { message: 'Session expired or invalid. Please log in again.' } });
  }

  req.user = userData.user;
  req.supabase = supabaseAsUser;
  return next();
}

module.exports = requireSupabaseAuth;
