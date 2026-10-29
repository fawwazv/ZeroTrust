// Bootstrap API Gateway (PEP, port 3000).
// /auth/* diarahkan auth.js (PE/PA); sisanya melewati pipeline PEP:
// route match -> token -> device -> policy.evaluate -> audit -> proxy.
require('dotenv').config();
const express = require('express');
const { connect } = require('../../db/connection');
const { registerAuthRoutes } = require('./auth');
const { writeAudit, userSubject } = require('./audit');
const { evaluate, matchRoute } = require('./policy');
const { proxyNilai, proxyTranskrip } = require('./proxy');
const { verifyToken } = require('../../shared/jwt');

const db = connect();
const app = express();

registerAuthRoutes(app, db); // registerAuthRoutes menambah express.json hanya di /auth/*

// [ZT] Pipeline PEP untuk endpoint selain /auth/* (PRD 3.2)
app.use((req, res, next) => {
  const url = new URL(req.originalUrl, 'http://internal');
  const path = url.pathname;
  const query = url.searchParams;

  // 1. route match; tidak cocok -> deny route_not_defined (diaudit)
  const m = matchRoute(req.method, path);
  if (!m) {
    writeAudit({ subject: 'anonymous', subjectType: 'anonymous', method: req.method, endpoint: req.originalUrl, deviceId: null, decision: 'deny', reason: 'route_not_defined', ip: req.ip });
    return res.status(403).json({ error: 'route_not_defined', message: 'route tidak terdaftar di tabel kebijakan' });
  }

  // 2. token Bearer wajib ada
  const auth = req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    writeAudit({ subject: 'anonymous', subjectType: 'anonymous', method: req.method, endpoint: req.originalUrl, deviceId: null, decision: 'deny', reason: 'missing_token', ip: req.ip });
    return res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <token> wajib ada' });
  }

  // 3. verifikasi tanda tangan + masa berlaku
  const v = verifyToken(token); // generik; pembedaan typ di tahap berikutnya
  if (!v.ok) {
    writeAudit({ subject: 'anonymous', subjectType: 'anonymous', method: req.method, endpoint: req.originalUrl, deviceId: null, decision: 'deny', reason: v.reason, ip: req.ip });
    return res.status(401).json({ error: v.reason, message: 'token tidak valid atau kedaluwarsa' });
  }
  const payload = v.payload;
  if (payload.typ !== 'access' && payload.typ !== 'service') {
    writeAudit({ subject: 'anonymous', subjectType: 'anonymous', method: req.method, endpoint: req.originalUrl, deviceId: null, decision: 'deny', reason: 'invalid_token', ip: req.ip });
    return res.status(401).json({ error: 'invalid_token', message: 'tipe token tidak dikenal' });
  }

  const subjectType = payload.typ === 'service' ? 'service' : 'user';
  const subject = subjectType === 'service' ? `service:${payload.sub}` : null;

  // [ZT] 4. device wajib terdaftar — hanya untuk token user (token service dikecualikan)
  let deviceId = req.header('X-Device-ID') || null;
  if (payload.typ === 'access') {
    if (!deviceId) {
      writeAudit({ subject: `user:${payload.sub}`, subjectType, method: req.method, endpoint: req.originalUrl, deviceId, decision: 'deny', reason: 'missing_device_id', ip: req.ip });
      return res.status(403).json({ error: 'missing_device_id', message: 'X-Device-ID wajib ada' });
    }
    const dev = db.prepare(`SELECT id FROM devices WHERE user_id = ? AND device_id = ?`).get(payload.sub, deviceId);
    if (!dev) {
      writeAudit({ subject: `user:${payload.sub}`, subjectType, method: req.method, endpoint: req.originalUrl, deviceId, decision: 'deny', reason: 'device_not_registered', ip: req.ip });
      return res.status(403).json({ error: 'device_not_registered', message: 'device tidak terdaftar untuk user ini' });
    }
  } else {
    deviceId = null;
  }

  // 5. keputusan policy (role, kepemilikan, status, jam akses)
  const dec = evaluate(db, { method: req.method, path, payload, query });

  // 6. audit SEMUA keputusan (allow dan deny)
  if (dec.decision === 'allow') {
    if (subjectType === 'user') {
      const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(payload.sub) || { id: payload.sub, username: 'unknown' };
      writeAudit({ subject: userSubject(u), subjectType, method: req.method, endpoint: req.originalUrl, deviceId, decision: 'allow', reason: 'allowed', ip: req.ip });
    } else {
      writeAudit({ subject, subjectType, method: req.method, endpoint: req.originalUrl, deviceId: null, decision: 'allow', reason: 'allowed', ip: req.ip });
    }
    // 7. allow -> teruskan ke service dengan X-Gateway-Secret (diset di proxy.js)
    return next();
  }
  writeAudit({
    subject: subjectType === 'user'
      ? userSubject(db.prepare(`SELECT * FROM users WHERE id = ?`).get(payload.sub) || { id: payload.sub, username: 'unknown' })
      : subject,
    subjectType,
    method: req.method,
    endpoint: req.originalUrl,
    deviceId,
    decision: 'deny',
    reason: dec.reason,
    ip: req.ip,
  });
  return res.status(dec.status).json({ error: dec.reason, message: 'request ditolak oleh kebijakan' });
});

// PEP forwarding dengan pathFilter (path asli tetap utuh ke service)
app.use(proxyNilai);
app.use(proxyTranskrip);

const PORT = parseInt(process.env.GATEWAY_PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`API Gateway (PEP) listening on port ${PORT}`);
});
