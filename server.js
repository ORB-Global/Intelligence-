require('dotenv').config();

// Real safety net: log any unhandled rejection/exception loudly
// instead of it disappearing silently or crashing the process
// without a trace. Does not by itself fix a hung request - the
// per-route asyncHandler wrapper in missionControl.js is what
// guarantees a response - this just makes any remaining crash
// visible in the logs.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const requireAdmin = require('./src/middleware/requireAdmin');

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const app = express();

app.use(cors());
app.use(express.json());

// REAL, CRITICAL FIX: express.static's default headers (ETag/
// Last-Modified, no explicit Cache-Control) let browsers serve a
// stale, cached copy of these security-critical auth-gated pages via
// heuristic caching or a 304 response - directly confirmed live: a
// real, fixed security bug kept reappearing in a real user's browser
// even after the server was correctly updated and verified serving
// the new file via curl. These two routes force browsers to always
// fetch a fresh copy, never reuse a cached one, and must be
// registered BEFORE the generic static middleware below so they take
// precedence for these two specific real, sensitive files.
['/vantage-v44.html', '/mission-control.html'].forEach((route) => {
  app.get(route, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', route));
  });
});

app.use(express.static(path.join(__dirname, 'public')));

function sendError(res, error, status = 500) {
  console.error(error);
  res.status(status).json({
    success: false,
    error: {
      message: error.message || 'Unexpected server error'
    }
  });
}

app.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      app: 'Orb Intelligence',
      status: 'running'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime())
    }
  });
});

app.get('/api/clients', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return sendError(res, new Error('Client not found'), 404);
    }

    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/clients/:id/snapshots', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 100);

    const { data, error } = await supabase
      .from('monthly_snapshots')
      .select('*')
      .eq('client_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/clients/:id/insights', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 100);

    const { data, error } = await supabase
      .from('insights')
      .select('*')
      .eq('client_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  const errors = [];

  const clientResult = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true });

  const snapshotResult = await supabase
    .from('monthly_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const insightResult = await supabase
    .from('insights')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (clientResult.error) errors.push(clientResult.error.message);
  if (snapshotResult.error) errors.push(snapshotResult.error.message);
  if (insightResult.error) errors.push(insightResult.error.message);

  res.json({
    success: true,
    data: {
      supabaseStatus: errors.length ? 'error' : 'connected',
      clientCount: clientResult.error ? null : clientResult.count || 0,
      latestSnapshot: snapshotResult.error ? null : snapshotResult.data,
      latestInsight: insightResult.error ? null : insightResult.data,
      errors
    }
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api', require('./src/routes/generateInsight'));
app.use('/api', require('./src/routes/chat'));
app.use('/api', require('./src/routes/publicAuth'));
app.use('/api/mc', require('./src/routes/missionControl'));
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { message: 'Route not found' }
  });
});

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`Orb Intelligence running on port ${PORT}`);
});
