/**
 * public/js/real-auth-guard.js
 *
 * Real, single, shared authentication gate - extracted VERBATIM from
 * mission-control.html's proven-working logic, so vantage-v44.html
 * uses the exact same real code, not a hand-ported copy. Four
 * separate hand-ported attempts in vantage-v44.html failed to
 * reproduce mission-control.html's correct behavior for reasons never
 * fully isolated remotely - a shared file removes any possibility of
 * a subtle difference between the two ever existing again.
 *
 * Usage: load this before any other script that needs auth, then call
 * window.realAuthGuard.requireSession() and await the real, verified
 * session before doing anything else.
 */
(function () {
  const SUPABASE_URL = 'https://vdhsvasxccdrashmvvdk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkaHN2YXN4Y2NkcmFzaG12dmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNDMyMDUsImV4cCI6MjEwMDkxOTIwNX0.rZvlbqrdYXlIeAKou-dllsO6MQr3ehzm7h3FBK2sZ6o';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = '/login.html';
  });

  // Real, exact requireSession - matches mission-control.html's
  // top-level gate byte for byte. Redirects immediately and NEVER
  // resolves if no real session exists, so calling code never
  // accidentally continues past this point.
  function requireSession() {
    return new Promise((resolve) => {
      client.auth.getSession().then(({ data }) => {
        if (!data.session) { window.location.href = '/login.html'; return; }
        resolve(data.session);
      });
    });
  }

  // Real, exact apiFetch - matches mission-control.html's proven
  // pattern: fresh getSession() check on every call, real 401 check
  // on every response, both with an immediate redirect.
  async function apiFetch(path, options = {}, timeoutMs = 15000) {
    const { data } = await client.auth.getSession();
    if (!data.session) { window.location.href = '/login.html'; throw new Error('No session'); }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(path, {
        ...options,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, ...(options.headers || {}) },
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs / 1000}s: ${path}`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Session expired'); }
    const body = await res.json();
    if (!res.ok || !body.success) throw Object.assign(new Error(body.error?.message || `HTTP ${res.status}`), { status: res.status });
    return body.data;
  }

  window.realAuthGuard = { client, requireSession, apiFetch };
})();
