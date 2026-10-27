// [ZT] shared/jwt.js: sign & verify access token dan token service (HS256)
// Verifikasi selalu cek tanda tangan, masa berlaku, DAN claim typ agar token
// service tidak bisa dipakai sebagai access token dan sebaliknya.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET tidak diset di environment');
}

// TTL diambil dari env agar bisa dioverride saat demo (mis. ACCESS_TOKEN_TTL=5s untuk A4)
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '10m';
const SERVICE_TOKEN_TTL = process.env.SERVICE_TOKEN_TTL || '5m';

// [ZT] Access token (user): 10 menit, claim sub/role/typ/jti
function signAccessToken(payload) {
  return jwt.sign(
    { sub: payload.sub, role: payload.role, typ: 'access' },
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_TTL,
      jwtid: crypto.randomUUID(),
    }
  );
}

// [ZT] Token service: 5 menit, khusus client_id Service Nilai
function signServiceToken(clientId) {
  return jwt.sign(
    { sub: clientId, role: 'service', typ: 'service' },
    JWT_SECRET,
    {
      expiresIn: SERVICE_TOKEN_TTL,
      jwtid: crypto.randomUUID(),
    }
  );
}

// [ZT] Verify: return objek {ok, reason|payload} tanpa throw,
// reason sesuai kode baku Tabel 5.5 (invalid_token / token_expired)
function verifyToken(token, expectedTyp) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ !== expectedTyp) {
      return { ok: false, reason: 'invalid_token' };
    }
    return { ok: true, payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { ok: false, reason: 'token_expired' };
    }
    return { ok: false, reason: 'invalid_token' };
  }
}

module.exports = { signAccessToken, signServiceToken, verifyToken };
