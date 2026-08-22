/**
 * Real staff-role gate for Supabase-authenticated routes, distinct
 * from requireAdmin.js (a separate, shared-password Basic Auth check
 * used only by the legacy /api/clients/* routes). This checks the
 * real, per-user organization_memberships.role for the specific
 * organization the request concerns - a client can never satisfy
 * this, structurally, since 'client' is never in the allowed set.
 */
async function requireStaffRole(req, res, next) {
  const locationId = req.params.id;
  if (!locationId) {
    return res.status(400).json({ success: false, error: { message: 'Location id required to verify staff role.' } });
  }

  const { data: location, error: locError } = await req.supabase.from('locations').select('organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data: membership, error: memError } = await req.supabase
    .from('organization_memberships')
    .select('role')
    .eq('organization_id', location.organization_id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (memError) return res.status(500).json({ success: false, error: { message: memError.message } });

  if (!membership || !['admin', 'account_manager'].includes(membership.role)) {
    return res.status(403).json({ success: false, error: { message: 'Staff role required for this action.' } });
  }

  req.staffRole = membership.role;
  return next();
}

module.exports = requireStaffRole;
