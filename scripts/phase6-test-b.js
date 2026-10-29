// Uji Fase 6 mode B: P8-P10 sukses path + L2 audit
require('dotenv').config();
const { connect } = require('../db/connection');
const db = connect();
const out = [];
const t = (n, c) => out.push((c ? 'PASS' : 'FAIL') + '  ' + n);

const B = 'http://localhost:3000';
const login = async (username, deviceId) => {
  const r = await fetch(B + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
    body: JSON.stringify({ username, password: 'password123' }),
  });
  return r.json();
};

(async () => {
  const dosen1 = await login('dosen1', 'DEV-DOSEN-1');
  const mhs1 = await login('mhs1', 'DEV-MHS-1');
  const admin1 = await login('admin1', 'DEV-ADMIN-1');
  const H = { Authorization: 'Bearer ' + dosen1.access_token, 'X-Device-ID': 'DEV-DOSEN-1' };
  const MH = { Authorization: 'Bearer ' + mhs1.access_token, 'X-Device-ID': 'DEV-MHS-1' };
  const AH = { Authorization: 'Bearer ' + admin1.access_token, 'X-Device-ID': 'DEV-ADMIN-1' };

  // P8 finalisasi kelas 1
  let r = await fetch(B + '/kelas/1/finalisasi', { method: 'POST', headers: H });
  const b = await r.json();
  t('P8 finalisasi -> 200 + pesan kelas difinalisasi', r.status === 200 && b.message === 'kelas difinalisasi' && b.kelas_id === 1 && b.jumlah_nilai === 3);

  // respon transkrip mhs1 punya 1 mk, 80 -> B
  r = await fetch(B + '/transkrip/207006001', { headers: MH });
  const tr = await r.json();
  t('P8a transkrip terisi 80->B', r.status === 200 && tr.data.length === 1 && tr.data[0].nilai_angka === 80 && tr.data[0].nilai_huruf === 'B');

  // status kelas & nilai final
  const kelas = db.prepare(`SELECT status FROM kelas WHERE id = 1`).get();
  const nilaiFinal = db.prepare(`SELECT COUNT(*) c FROM nilai WHERE kelas_id = 1 AND status = 'final'`).get().c;
  t('P8b kelas + 3 nilai jadi final', kelas.status === 'final' && nilaiFinal === 3);

  // P9 PUT setelah final
  r = await fetch(B + '/nilai/1', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 95 }) });
  t('P9 PUT setelah final -> 403 grade_already_final', r.status === 403 && (await r.json()).error === 'grade_already_final');

  // P10 finalisasi ulang
  r = await fetch(B + '/kelas/1/finalisasi', { method: 'POST', headers: H });
  t('P10 finalisasi ulang -> 403 class_already_final', r.status === 403 && (await r.json()).error === 'class_already_final');

  // L2 audit: sinkron tercatat sebagai service:service-nilai
  const l2 = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE subject = 'service:service-nilai' AND endpoint = '/transkrip/sinkron' AND decision = 'allow'`).get().c;
  t('L2 sinkron tercatat subjek service:service-nilai', l2 >= 1);

  // admin tahun transkrip lain
  r = await fetch(B + '/transkrip/207006003', { headers: AH });
  const tr3 = await r.json();
  t('P8c admin baca transkrip mhs3 (90->A)', r.status === 200 && tr3.data.length === 1 && tr3.data[0].nilai_huruf === 'A');

  console.log(out.join('\n'));
})();
