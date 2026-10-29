// [ZT] proxy.js: PEP forwarding — gateway menyuntik X-Gateway-Secret asli dan
// MENIMPA header dengan nama sama bila client memalsukannya (skenario G5).
const { createProxyMiddleware } = require('http-proxy-middleware');
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const NILAI_TARGET = process.env.NILAI_URL || 'http://localhost:3001';
const TRANSKRIP_TARGET = process.env.TRANSKRIP_URL || 'http://localhost:3002';

// [ZT] PEP forwarding: pathFilter dipakai DI MOUNT ROOT supaya path asli
// tetap diteruskan utuh ke service (mount '/nilai' di app.use akan strip path).
const proxyNilai = createProxyMiddleware({
  pathFilter: ['/nilai', '/kelas'],
  target: NILAI_TARGET,
  changeOrigin: false,
  logLevel: 'warn',
  on: {
    proxyReq: (proxyReq) => {
      proxyReq.setHeader('X-Gateway-Secret', GATEWAY_SECRET);
    },
  },
});

const proxyTranskrip = createProxyMiddleware({
  pathFilter: ['/transkrip'],
  target: TRANSKRIP_TARGET,
  changeOrigin: false,
  logLevel: 'warn',
  on: {
    proxyReq: (proxyReq) => {
      proxyReq.setHeader('X-Gateway-Secret', GATEWAY_SECRET);
    },
  },
});

module.exports = { proxyNilai, proxyTranskrip };
