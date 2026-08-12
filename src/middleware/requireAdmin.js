const crypto = require('crypto');

const ADMIN_KEY = process.env.ORB_ADMIN_KEY;

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');

  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    console.error('ORB_ADMIN_KEY is not set — refusing all admin-protected requests until it is configured.');
    return res.status(500).json({ success: false, error: { message: 'Server auth is not configured.' } });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="Orb Intelligence Admin"');
    return res.status(401).json({ success: false, error: { message: 'Authentication required.' } });
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (err) {
    res.set('WWW-Authenticate', 'Basic realm="Orb Intelligence Admin"');
    return res.status(401).json({ success: false, error: { message: 'Malformed credentials.' } });
  }

  const separatorIndex = decoded.indexOf(':');
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;

  if (!timingSafeEqualStr(password, ADMIN_KEY)) {
    res.set('WWW-Authenticate', 'Basic realm="Orb Intelligence Admin"');
    return res.status(401).json({ success: false, error: { message: 'Invalid credentials.' } });
  }

  return next();
}

module.exports = requireAdmin;

