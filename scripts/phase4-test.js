// Uji Fase 4 (sementara): G1-G4 + smoke test scoping sesuai PRD
require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET;
const jwt = require('../shared/jwt');

(async () => {
  const out = [];
  const t = (n, c) => out.push((c ? 'PASS' : 'FAIL') + '  ' + n);
  const g = (u, h) => fetch(u, { headers: h }).then(async (r) => ({ s: r.status, b: await r.json() }));
  const secretHeader = { 'X-Gateway-Secret': process.env.GATEWAY_SECRET };

  const tok = jwt.signAccessToken({ sub: 4, role: 'mahasiswa' });
  const dosen = jwt.signAccessToken({ sub: 2, role: 'dosen' });
  const adm = jwt.signAccessToken({ sub: 1, role: 'admin' });
  const svc = jwt.signServiceToken(process.env.SERVICE_NILAI_CLIENT_ID);

  // G3: secret benar, tanpa token
  let r = await g('http://localhost:3001/nilai', secretHeader);
  t('G3 3001 secret benar tanpa token -> 401 missing_token', r.s === 401 && r.b.error === 'missing_token');
  r = await g('http://localhost:3002/transkrip/207006001', secretHeader);
  t('G3 3002 secret benar tanpa token -> 401 missing_token', r.s === 401 && r.b.error === 'missing_token');

  // G4: secret benar + token palsu
  r = await g('http://localhost:3001/nilai', { ...secretHeader, Authorization: 'Bearer palsu.palsu.palsu' });
  t('G4 3001 token palsu -> 401 invalid_token', r.s === 401 && r.b.error === 'invalid_token');

  r = await g('http://localhost:3001/nilai', { ...secretHeader, Authorization: 'Bearer ' + tok });
  t('P1 mhs1 GET /nilai -> hanya nilai mhs1 (2 baris)', r.s === 200 && r.b.data.length === 2 && r.b.data.every((x) => x.nim === '207006001'));

  r = await g('http://localhost:3001/nilai?kelas_id=2', { ...secretHeader, Authorization: 'Bearer ' + dosen });
  t('P3 dosen1 GET /nilai?kelas_id=2 -> 403 not_class_owner', r.s === 403 && r.b.error === 'not_class_owner');

  r = await fetch('http://localhost:3001/nilai/4', {
    method: 'PUT',
    headers: { ...secretHeader, 'Content-Type': 'application/json', Authorization: 'Bearer ' + dosen },
    body: JSON.stringify({ nilai_angka: 95 }),
  });
  t('P6 dosen1 PUT nilai kelas 2 -> 403 not_class_owner', r.status === 403 && (await r.json()).error === 'not_class_owner');

  r = await g('http://localhost:3002/transkrip/207006002', { ...secretHeader, Authorization: 'Bearer ' + tok });
  t('P12 mhs1 GET transkrip mhs lain -> 403 not_own_data', r.s === 403 && r.b.error === 'not_own_data');

  r = await g('http://localhost:3002/transkrip/207006001', { ...secretHeader, Authorization: 'Bearer ' + tok });
  t('transkrip milik sendiri sebelum sinkron -> 200 []', r.s === 200 && r.b.data.length === 0);

  r = await fetch('http://localhost:3002/transkrip/sinkron', {
    method: 'POST',
    headers: { ...secretHeader, 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ kelas_id: 1, items: [{ nim: '207006001', nilai_angka: 80 }] }),
  });
  t('P15 token USER ke sinkron -> 403 service_token_required', r.status === 403 && (await r.json()).error === 'service_token_required');

  r = await fetch('http://localhost:3002/transkrip/sinkron', {
    method: 'POST',
    headers: { ...secretHeader, 'Content-Type': 'application/json', Authorization: 'Bearer ' + svc },
    body: JSON.stringify({ kelas_id: 1, kode_mk: 'KP70065004', nama_mk: 'Keamanan Informasi', items: [{ nim: '207006001', nilai_angka: 80 }] }),
  });
  const b = await r.json();
  t('P16 token service ke sinkron -> 200 + respon sinkron', r.status === 200 && !!b.message && b.jumlah === 1);

  r = await fetch('http://localhost:3002/transkrip/sinkron', {
    method: 'POST',
    headers: { ...secretHeader, 'Content-Type': 'application/json', Authorization: 'Bearer ' + svc },
    body: JSON.stringify({ kelas_id: 1, kode_mk: 'X', nama_mk: 'X', items: [{ nim: 'nim-palsu', nilai_angka: 50 }, {}] }),
  });
  t('keputusan#4 payload invalid -> 422 seluruh ditolak', r.status === 422);

  r = await g('http://localhost:3002/transkrip/207006001', { ...secretHeader, Authorization: 'Bearer ' + adm });
  t('P13 admin GET transkrip -> 200 + huruf sesuai PRD (80=B)', r.s === 200 && r.b.data.length === 1 && r.b.data[0].nilai_huruf === 'B');

  const { connect } = require('../db/connection');
  const n = connect().prepare("SELECT COUNT(*) c FROM transkrip WHERE nim = 'nim-palsu'").get().c;
  t('DB: payload invalid tidak menyimpan apa pun', n === 0);

  // PUT happy path: dosen1 ubah nilai kelas 1
  r = await fetch('http://localhost:3001/nilai/1', {
    method: 'PUT',
    headers: { ...secretHeader, 'Content-Type': 'application/json', Authorization: 'Bearer ' + dosen },
    body: JSON.stringify({ nilai_angka: 88 }),
  });
  const b3 = await r.json();
  t('PUT dosen1 nilai kelas 1 -> 200 terupdate', r.status === 200 && b3.data && b3.data.nilai_angka === 88);

  r = await fetch('http://localhost:3001/nilai/1', {
    method: 'PUT',
    headers: { ...secretHeader, 'Content-Type': 'application/json', Authorization: 'Bearer ' + dosen },
    body: JSON.stringify({ nilai_angka: 999 }),
  });
  t('PUT nilai_angka 999 -> 400 (dec P5)', r.status === 400);

  r = await g('http://localhost:3001/nilai', { ...secretHeader, Authorization: 'Bearer ' + dosen });
  t('P2 dosen1 GET /nilai -> hanya kelas 1 (3 baris)', r.s === 200 && r.b.data.length === 3);

  console.log(out.join('\n'));
})();
