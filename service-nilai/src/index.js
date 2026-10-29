// [ZT] service-nilai/src/index.js: bootstrap Service Nilai (port 3001).
// Two layers of defense in depth: gateway secret THEN re-verification of the access token.
require('dotenv').config();
const express = require('express');
const { connect } = require('../../db/connection');
const { requireGatewaySecret } = require('../../shared/gateway-secret');
const { verifyToken } = require('../../shared/jwt');
const routes = require('./routes');

const app = express();
const db = connect();

// [ZT] Layer 1: deny direct call (curl :3001) not through the gateway
app.use(requireGatewaySecret);

// [ZT] Layer 2: access token must be valid; don't rely on the gateway's decision
app.use((req, res, next) => {
  const auth = req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <token> wajib ada' });
  }
  const v = verifyToken(auth.slice(7), 'access');
  if (!v.ok) {
    // token_expired / invalid_token -> 401
    return res.status(401).json({ error: v.reason, message: 'token tidak valid atau kedaluwarsa' });
  }
  req.user = v.payload; // { sub, role, typ }
  next();
});

app.use(express.json());
app.use(routes(db));

const PORT = parseInt(process.env.NILAI_PORT || '3001', 10);
app.listen(PORT, () => {
  console.log(`Service Nilai listening on port ${PORT}`);
});
