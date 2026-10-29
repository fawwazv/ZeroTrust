// Uji Fase 5 (sementara): P1-P19, C1-C4, G5, audit — semua lewat gateway :3000
require('dotenv').config();
const fs = require('fs');
const { connect } = require('../db/connection');

const B = 'http://localhost:3000';
const db = connect();
const out = [];
const t = (n, c) => out.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const CFG = 'config/access-hours.json';
const CFG_BACKUP = fs.readFileSync(CFG, 'utf-8');

(async () => {
  const post = (path, body, headers = {}) =>
    fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = (path, headers = {}) => fetch(B + path, { headers });
  const H = (token, deviceId) => {
    const h = { Authorization: 'Bearer ' + token };
    if (deviceId) h['X-Device-ID'] = deviceId;
    return h;
  };
  const login = async (username, deviceId) => {
    const r = await post('/auth/login', { username, password: 'password123' }, { 'X-Device-ID': deviceId });
    return r.json();
  };

  // login semua aktor
  const mhs1 = await login('mhs1', 'DEV-MHS-1');
  const mhs2 = await login('mhs2', 'DEV-MHS-2');
  const dosen1 = await login('dosen1', 'DEV-DOSEN-1');
  const dosen2 = await login('dosen2', 'DEV-DOSEN-2');
  const admin1 = await login('admin1', 'DEV-ADMIN-1');
  t('login semua aktor', ![mhs1, mhs2, dosen1, dosen2, admin1].some((x) => !x.access_token));

  // ===== P1..P7 =====
  let r = await get('/nilai', H(mhs1.access_token, 'DEV-MHS-1'));
  let b = await r.json();
  t('P1 mhs1/lihat nilai miliknya 2 baris', r.status === 200 && b.data.length === 2 && b.data.every((x) => x.nim === '207006001'));

  r = await get('/nilai', H(dosen1.access_token, 'DEV-DOSEN-1'));
  b = await r.json();
  t('P2 dosen1 nilai kelas 1 saja (3 baris)', r.status === 200 && b.data.length === 3);

  r = await get('/nilai?kelas_id=2', H(dosen1.access_token, 'DEV-DOSEN-1'));
  t('P3 403 not_class_owner', r.status === 403 && (await r.json()).error === 'not_class_owner');

  r = await fetch(B + '/nilai/1', { method: 'PUT', headers: { ...H(mhs1.access_token, 'DEV-MHS-1') }, body: JSON.stringify({ nilai_angka: 90 }) });
  t('P4 mhs PUT -> 403 role_not_allowed', r.status === 403 && (await r.json()).error === 'role_not_allowed');

  r = await fetch(B + '/nilai/1', { method: 'PUT', headers: { ...H(dosen1.access_token, 'DEV-DOSEN-1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 88 }) });
  b = await r.json();
  t('P5 dosen1 PUT kelas 1 -> 200', r.status === 200 && b.data.nilai_angka === 88);

  r = await fetch(B + '/nilai/4', { method: 'PUT', headers: { ...H(dosen1.access_token, 'DEV-DOSEN-1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 88 }) });
  t('P6 PUT kelas 2 -> 403 not_class_owner', r.status === 403 && (await r.json()).error === 'not_class_owner');

  r = await post('/kelas/2/finalisasi', {}, H(dosen1.access_token, 'DEV-DOSEN-1'));
  t('P7 finalisasi kelas 2 -> 403 not_class_owner', r.status === 403 && (await r.json()).error === 'not_class_owner');

  // ===== C1 device =====
  r = await get('/nilai', { Authorization: 'Bearer ' + dosen2.access_token }); // tanpa device
  t('C1a tanpa X-Device-ID -> 403 missing_device_id', r.status === 403 && (await r.json()).error === 'missing_device_id');
  r = await get('/nilai', H(dosen2.access_token, 'DEV-MHS-1'));
  t('C1b device salah -> 403 device_not_registered', r.status === 403 && (await r.json()).error === 'device_not_registered');

  // ===== C2/C3 jam akses: config diluar rentang =====
  fs.writeFileSync(CFG, JSON.stringify({ enabled: true, start: '23:00', end: '23:59', timezone: 'Asia/Jakarta' }));
  r = await fetch(B + '/nilai/1', { method: 'PUT', headers: { ...H(dosen1.access_token, 'DEV-DOSEN-1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 90 }) });
  t('C2 PUT di luar jam -> 403 outside_access_hours', r.status === 403 && (await r.json()).error === 'outside_access_hours');
  r = await post('/kelas/1/finalisasi', {}, H(dosen1.access_token, 'DEV-DOSEN-1'));
  t('C3 finalisasi luar jam -> 403 outside_access_hours', r.status === 403 && (await r.json()).error === 'outside_access_hours');

  // ===== C4 kembalikan config tanpa restart =====
  fs.writeFileSync(CFG, CFG_BACKUP);
  r = await fetch(B + '/nilai/2', { method: 'PUT', headers: { ...H(dosen1.access_token, 'DEV-DOSEN-1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 75 }) });
  t('C4 PUT di jam akses tanpa restart -> 200', r.status === 200);

  // ===== P11..P14 transkrip =====
  r = await get('/transkrip/207006001', H(mhs1.access_token, 'DEV-MHS-1'));
  t('P11 mhs1 transkrip sendiri -> 200', r.status === 200);
  r = await get('/transkrip/207006002', H(mhs1.access_token, 'DEV-MHS-1'));
  t('P12 mhs1 transkrip orang lain -> 403 not_own_data', r.status === 403 && (await r.json()).error === 'not_own_data');
  r = await get('/transkrip/207006002', H(admin1.access_token, 'DEV-ADMIN-1'));
  t('P13 admin baca semua -> 200', r.status === 200);
  r = await get('/transkrip/207006001', H(dosen1.access_token, 'DEV-DOSEN-1'));
  t('P14 dosen transkrip -> 403 role_not_allowed', r.status === 403 && (await r.json()).error === 'role_not_allowed');

  // ===== P15..P17 service token =====
  r = await post('/auth/service', { client_id: process.env.SERVICE_NILAI_CLIENT_ID, client_secret: process.env.SERVICE_NILAI_CLIENT_SECRET });
  const svc = (await r.json()).access_token;
  r = await post('/transkrip/sinkron', { kelas_id: 1, kode_mk: 'KP70065004', nama_mk: 'Keamanan Informasi', items: [{ nim: '207006001', nilai_angka: 88 }] }, H(mhs1.access_token, 'DEV-MHS-1'));
  const p15b = await r.json();
  t('P15 token user ke sinkron -> 403 service_token_required', r.status === 403 && p15b.error === 'service_token_required');
  r = await post('/transkrip/sinkron', { kelas_id: 1, kode_mk: 'KP70065004', nama_mk: 'Keamanan Informasi', items: [{ nim: '207006001', nilai_angka: 88 }] }, { Authorization: 'Bearer ' + svc });
  t('P16 token service ke sinkron via gateway -> 200', r.status === 200);
  r = await get('/nilai', { Authorization: 'Bearer ' + svc });
  t('P17 token service di /nilai -> 403 service_token_not_allowed', r.status === 403 && (await r.json()).error === 'service_token_not_allowed');

  // ===== P18/P19 =====
  r = await get('/nilai');
  t('P18 tanpa token -> 401 missing_token', r.status === 401 && (await r.json()).error === 'missing_token');
  r = await get('/admin', H(admin1.access_token, 'DEV-ADMIN-1'));
  t('P19 route tak dikenal -> 403 route_not_defined', r.status === 403 && (await r.json()).error === 'route_not_defined');

  // ===== G5 header palsu dari client dikendalikan gateway =====
  r = await get('/nilai', { ...H(dosen1.access_token, 'DEV-DOSEN-1'), 'X-Gateway-Secret': 'palsu' });
  const g5b = await r.json();
  t('G5 client kirim secret palsu -> kebijakan tetap berlaku (200)', r.status === 200 && Array.isArray(g5b.data));

  // ===== audit log =====
  const total = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
  t('audit: total keputusan tercatat', total > 20);
  t('audit: tidak ada token mentah/password', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE endpoint LIKE '%password%'").get().c === 0);

  console.log(out.join('\n'));
})();
