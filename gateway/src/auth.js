// [ZT] auth.js: PE/PA di dalam gateway — login, refresh, logout, token service.
// Semua keputusan (sukses/gagal) dicatat ke audit_log dengan reason baku Tabel 5.5.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { signAccessToken, signServiceToken } = require('../../shared/jwt');
const { writeAudit, userSubject } = require('./audit');

// [ZT] Shuffle buffer juga disederhanakan: pakai crypto.randomBytes saja
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '1', 10);

// [ZT] Wajib ada header X-Device-ID dan terdaftar untuk user (berlaku di /auth/login)
function checkDevice(req, user, db) {
  const deviceId = req.header('X-Device-ID');
  if (!deviceId) return { ok: false, reason: 'missing_device_id', status: 403 };
  const device = db
    .prepare(`SELECT id FROM devices WHERE user_id = ? AND device_id = ?`)
    .get(user.id, deviceId);
  if (!device) return { ok: false, reason: 'device_not_registered', status: 403 };
  return { ok: true, deviceId };
}

// [ZT] Audit helper: deny selalu tercatat, subjek anonymous bila user tak dikenal
function denyAudit(db, req, user, reason) {
  const subject = user ? userSubject(user) : 'anonymous';
  const subjectType = user ? 'user' : 'anonymous';
  writeAudit({
    subject,
    subjectType,
    method: req.method,
    endpoint: req.originalUrl,
    deviceId: req.header('X-Device-ID') || null,
    decision: 'deny',
    reason,
    ip: req.ip,
  });
}

function allowAudit(req, user, reason, deviceId) {
  writeAudit({
    subject: userSubject(user),
    subjectType: 'user',
    method: req.method,
    endpoint: req.originalUrl,
    deviceId: deviceId || null,
    decision: 'allow',
    reason,
    ip: req.ip,
  });
}

// POST /auth/login — kredensial valid DAN device terdaftar
function login(db) {
  return (req, res) => {
    const { username, password } = req.body || {};
    const user = username
      ? db.prepare(`SELECT * FROM users WHERE username = ?`).get(username)
      : null;
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      // [ZT] Jangan bocorkan apakah username ada; deny tetap diaudit
      denyAudit(db, req, user, 'invalid_credentials');
      return res.status(401).json({ error: 'invalid_credentials', message: 'username atau password salah' });
    }
    const device = checkDevice(req, user, db);
    if (!device.ok) {
      denyAudit(db, req, user, device.reason);
      return res.status(device.status).json({ error: device.reason, message: 'device tidak terdaftar atau tidak ada' });
    }

    // [ZT] Refresh token: string acak 64 byte (hex), bukan JWT. Yang disimpan hanya SHA-256-nya.
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(user.id, sha256(refreshToken), device.deviceId, expiresAt, new Date().toISOString());

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    allowAudit(req, user, 'login_success', device.deviceId);
    return res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: parseTtlSeconds(process.env.ACCESS_TOKEN_TTL || '10m'),
    });
  };
}

// POST /auth/refresh — token valid, belum dicabut, belum kedaluwarsa
function refresh(db) {
  return (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    const stored = refreshToken
      ? db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`).get(sha256(refreshToken))
      : null;
    const badToken =
      !stored || stored.revoked || new Date(stored.expires_at) <= new Date();
    if (badToken) {
      const userOfToken = stored
        ? db.prepare(`SELECT * FROM users WHERE id = ?`).get(stored.user_id)
        : null;
      denyAudit(db, req, userOfToken, 'invalid_refresh_token');
      return res.status(401).json({ error: 'invalid_refresh_token', message: 'refresh token tidak dikenal, kedaluwarsa, atau sudah dicabut' });
    }
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(stored.user_id);
    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    allowAudit(req, user, 'refresh_success', stored.device_id);
    return res.json({
      access_token: accessToken,
      expires_in: parseTtlSeconds(process.env.ACCESS_TOKEN_TTL || '10m'),
    });
  };
}

// POST /auth/logout — mencabut refresh token (revoked = 1)
function logout(db) {
  return (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    const stored = refreshToken
      ? db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`).get(sha256(refreshToken))
      : null;
    if (!stored || stored.revoked || new Date(stored.expires_at) <= new Date()) {
      denyAudit(db, req, null, 'invalid_refresh_token');
      return res.status(401).json({ error: 'invalid_refresh_token', message: 'refresh token tidak dikenal, kedaluwarsa, atau sudah dicabut' });
    }
    // [ZT] Revoke, bukan hapus, agar jejak tetap ada dan tidak bisa dipakai ulang
    db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`).run(stored.id);
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(stored.user_id);
    allowAudit(req, user, 'logout_success', stored.device_id);
    return res.json({ message: 'logged out' });
  };
}

// POST /auth/service — client_id + client_secret valid -> token service
function serviceToken(db) {
  return (req, res) => {
    const { client_id: clientId, client_secret: clientSecret } = req.body || {};
    const client = clientId
      ? db.prepare(`SELECT * FROM service_clients WHERE client_id = ?`).get(clientId)
      : null;
    if (!client || !bcrypt.compareSync(clientSecret || '', client.secret_hash)) {
      writeAudit({
        subject: client ? `service:${clientId}` : 'service:' + (clientId || 'unknown'),
        subjectType: 'service',
        method: req.method,
        endpoint: req.originalUrl,
        deviceId: null,
        decision: 'deny',
        reason: 'invalid_service_credentials',
        ip: req.ip,
      });
      return res.status(401).json({ error: 'invalid_service_credentials', message: 'client_id atau client_secret salah' });
    }
    const accessToken = signServiceToken(clientId);
    writeAudit({
      subject: `service:${clientId}`,
      subjectType: 'service',
      method: req.method,
      endpoint: req.originalUrl,
      deviceId: null,
      decision: 'allow',
      reason: 'service_token_issued',
      ip: req.ip,
    });
    return res.json({ access_token: accessToken, expires_in: parseTtlSeconds(process.env.SERVICE_TOKEN_TTL || '5m') });
  };
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// '10m' -> 600 untuk field expires_in pada respons login/refresh/service
function parseTtlSeconds(ttl) {
  const m = /^(\d+)([smhd]?)$/.exec(ttl);
  if (!m) return 600;
  const unit = m[2] || 's';
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return parseInt(m[1], 10) * mult;
}

function registerAuthRoutes(app, db) {
  // [ZT] express.json() hanya pada route /auth/* (JANGAN global; body request
  // yang sudah dibaca akan membuat http-proxy hang di Fase 5)
  const router = require('express').Router();
  router.use(require('express').json());
  router.post('/login', login(db));
  router.post('/refresh', refresh(db));
  router.post('/logout', logout(db));
  router.post('/service', serviceToken(db));
  app.use('/auth', router);
}

module.exports = { registerAuthRoutes };
