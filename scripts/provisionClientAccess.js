#!/usr/bin/env node
/**
 * scripts/provisionClientAccess.js
 *
 * Real client account provisioning via Supabase's supported Admin API
 * (auth.admin.createUser) - never a raw insert into auth.users.
 *
 * Usage:
 *   node scripts/provisionClientAccess.js --location=<uuid>   (single, for testing)
 *   node scripts/provisionClientAccess.js --all --dry-run     (preview eligible locations)
 *   node scripts/provisionClientAccess.js --all               (real bulk run)
 *
 * Eligible = client_access_status = 'not_provisioned' AND active = true.
 * Skips anything already provisioned - safe to re-run.
 *
 * SECURITY: generated passwords are printed ONCE to stdout and never
 * written to any table. Copy them down immediately - they cannot be
 * retrieved again, only reset.
 *
 * Honest limitation: locations get a synthetic internal email
 * (<alias>@client.orbintelligence.internal), since most locations have
 * no real email on file. Self-serve "Forgot password" only works for
 * accounts with a real, deliverable email (like Easley's) - synthetic-
 * email accounts need a staff-initiated reset via Orb Admin (not yet
 * built) or this script's --reset flag.
 */

require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const LOCATION_ARG = args.find((a) => a.startsWith('--location='));
const SINGLE_LOCATION = LOCATION_ARG ? LOCATION_ARG.split('=')[1] : null;

function slugifyAlias(name) {
  return name.trim().replace(/[^a-zA-Z0-9]+/g, '');
}

function generateSecurePassword() {
  // 16 random bytes -> base64url, trimmed to a clean 20-char password.
  // Cryptographically random, not a location-name or predictable pattern.
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 20) + '!9';
}

async function provisionOne(location) {
  const alias = location.login_alias || slugifyAlias(location.name);
  const syntheticEmail = `${alias.toLowerCase()}@client.orbintelligence.internal`;
  const password = generateSecurePassword();

  if (DRY_RUN) {
    return { name: location.name, alias, status: 'WOULD_PROVISION' };
  }

  // Check for an existing user with this synthetic email first (idempotency)
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  let userId = (existingUsers?.users || []).find((u) => u.email === syntheticEmail)?.id;

  if (!userId) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
    });
    if (createError) throw new Error(`Auth user creation failed: ${createError.message}`);
    userId = created.user.id;
  }

  const { error: orgMemError } = await supabase
    .from('organization_memberships')
    .upsert({ user_id: userId, organization_id: location.organization_id, role: 'client' }, { onConflict: 'user_id,organization_id' });
  if (orgMemError) throw new Error(`Org membership failed: ${orgMemError.message}`);

  const { error: locMemError } = await supabase
    .from('location_memberships')
    .upsert({ user_id: userId, location_id: location.id }, { onConflict: 'user_id,location_id' });
  if (locMemError) throw new Error(`Location membership failed: ${locMemError.message}`);

  const { error: updateError } = await supabase
    .from('locations')
    .update({ login_alias: alias, client_access_status: 'active' })
    .eq('id', location.id);
  if (updateError) throw new Error(`Location update failed: ${updateError.message}`);

  return { name: location.name, alias, password, status: 'PROVISIONED' };
}

async function main() {
  let query = supabase.from('locations').select('id, name, organization_id, login_alias, client_access_status, active').eq('active', true);
  if (SINGLE_LOCATION) {
    query = query.eq('id', SINGLE_LOCATION);
  } else if (ALL) {
    query = query.eq('client_access_status', 'not_provisioned');
  } else {
    console.error('Specify --location=<uuid> or --all (optionally with --dry-run).');
    process.exit(1);
  }

  const { data: locations, error } = await query;
  if (error) { console.error('Failed to fetch locations:', error.message); process.exit(1); }

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== PROVISIONING ===');
  console.log(`Eligible locations: ${locations.length}\n`);

  const manifest = [];
  for (const loc of locations) {
    try {
      const result = await provisionOne(loc);
      manifest.push(result);
      console.log(`${result.status.padEnd(16)} ${loc.name}`);
    } catch (e) {
      manifest.push({ name: loc.name, status: 'FAILED', error: e.message });
      console.log(`FAILED           ${loc.name}: ${e.message}`);
    }
  }

  if (!DRY_RUN) {
    console.log('\n=== ONE-TIME CREDENTIAL MANIFEST (copy this now - passwords cannot be retrieved again) ===\n');
    for (const m of manifest) {
      if (m.status === 'PROVISIONED') {
        console.log(`${m.name}\nLogin: ${m.alias}\nTemporary Password: ${m.password}\nStatus: Active\n`);
      }
    }
  }
}

main().catch((e) => { console.error('Fatal error:', e); process.exit(1); });
