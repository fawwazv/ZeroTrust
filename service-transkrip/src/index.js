// [ZT] service-transkrip/src/index.js: bootstrap Service Transkrip (port 3002).
// Two layers: gateway secret THEN re-verification of the token (access or service per route).
require('dotenv').config();
const express = require('express');
const { connect } = require('../../db/connection');
const { requireGatewaySecret } = require('../../shared/gateway-secret');
const { verifyToken } = require('../../shared/jwt');
const routes = require('./routes');

const app = express();
const db = connect();

// [ZT] Layer 1: deny direct call not through the gateway
app.use(requireGatewaySecret);

app.use(express.json());

// [ZT] Expect access token (user)
function requireAccessToken(req, res, next) {
  const auth = req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <token> wajib ada' });
  }
  const v = verifyToken(auth.slice(7), 'access');
  if (!v.ok) return res.status(401).json({ error: v.reason, message: 'token tidak valid atau kedaluwarsa' });
  req.user = v.payload;
  next();
}

// [ZT] Service token is REQUIRED for /transkrip/sinkron — user tokens are ALL denied
function requireServiceToken(req, res, next) {
  const auth = req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <token> wajib ada' });
  }
  const v = verifyToken(auth.slice(7), 'service');
  if (!v.ok) {
    // Token user (typ=access/even admin) is also rejected here
    return res.status(403).json({ error: 'service_token_required', message: 'hanya token service yang diperbolehkan' });
  }
  req.service = v.payload; // { sub: client_id, role: 'service' }
  next();
}

app.get('/transkrip/:nim', requireGatewaySecret, requireAccessToken, routes.getTranskrip(db));
app.post('/transkrip/sinkron', requireGatewaySecret, requireServiceToken, routes.sinkron(db));

const PORT = parseInt(process.env.TRANSKRIP_PORT || '3002', 10);
app.listen(PORT, () => {
  console.log(`Service Transkrip listening on port ${PORT}`);
});
