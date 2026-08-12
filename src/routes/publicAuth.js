/**
 * Public, unauthenticated endpoint - runs BEFORE login. Resolves a
 * client-facing login alias ("Easley") to the real internal Supabase
 * Auth email, so the client-facing login page never has to show or
 * accept a synthetic/internal email address.
 *
 * Careful by design: returns the same generic response whether the
 * alias doesn't exist, isn't active, or has no linked user - never
 * lets a caller distinguish those cases (that would let someone probe
 * for valid client names).
 */

const express = require('express');
const supabase = require('../config/supabase'); // service-role client - required here, this runs before any user is authenticated

const router = express.Router();

const GENERIC_ERROR = { success: false, error: { message: 'Account not found or not active. Contact your Orb Global representative.' } };

router.post('/resolve-login', async (req, res) => {
  const alias = req.body && typeof req.body.account === 'string' ? req.body.account.trim() : '';
  if (!alias) return res.status(400).json(GENERIC_ERROR);

  const { data: location, error: locError } = await supabase
    .from('locations')
    .select('id')
    .ilike('login_alias', alias)
    .eq('client_access_status', 'active')
    .maybeSingle();

  if (locError || !location) return res.status(404).json(GENERIC_ERROR);

  const { data: membership, error: memError } = await supabase
    .from('location_memberships')
    .select('user_id')
    .eq('location_id', location.id)
    .limit(1)
    .maybeSingle();

  if (memError || !membership) return res.status(404).json(GENERIC_ERROR);

  const { data: userResult, error: userError } = await supabase.auth.admin.getUserById(membership.user_id);
  if (userError || !userResult || !userResult.user) return res.status(404).json(GENERIC_ERROR);

  return res.json({ success: true, data: { email: userResult.user.email } });
});

module.exports = router;
