// [ZT] shared/gateway-secret.js: middleware cek X-Gateway-Secret di kedua service.
// Request yang tidak lewat gateway (panggilan langsung ke port 3001/3002) ditolak 403.
const crypto = require('crypto');

const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
if (!GATEWAY_SECRET) {
  throw new Error('GATEWAY_SECRET tidak diset di environment');
}

const secretBuf = Buffer.from(GATEWAY_SECRET, 'utf-8');

// [ZT] Bandingkan dengan timingSafeEqual agar tahan timing attack
function safeEqual(headerValue) {
  if (!headerValue) return false;
  const given = Buffer.from(headerValue, 'utf-8');
  if (given.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(given, secretBuf);
}

function requireGatewaySecret(req, res, next) {
  const headerValue = req.header('X-Gateway-Secret');
  if (!headerValue) {
    return res.status(403).json({ error: 'missing_gateway_secret' });
  }
  if (!safeEqual(headerValue)) {
    return res.status(403).json({ error: 'invalid_gateway_secret' });
  }
  next();
}

module.exports = { requireGatewaySecret };
