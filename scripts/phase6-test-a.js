// Uji Fase 6: P8-P10 (finalisasi + sinkron), rollback bila sinkron gagal, L2 audit
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
  const H = { Authorization: 'Bearer ' + dosen1.access_token, 'X-Device-ID': 'DEV-DOSEN-1' };
  const MH = { Authorization: 'Bearer ' + mhs1.access_token, 'X-Device-ID': 'DEV-MHS-1' };

  // ========= MODE A: transkrip service DOWN -> sinkron gagal, kelas TIDAK final =========
  const r = await fetch(B + '/kelas/1/finalisasi', { method: 'POST', headers: H });
  t('sinkron gagal -> 502', r.status === 502);
  const kelasStatus = db.prepare(`SELECT status FROM kelas WHERE id = 1`).get().status;
  const nilaiDraft = db.prepare(`SELECT COUNT(*) c FROM nilai WHERE kelas_id = 1 AND status = 'draft'`).get().c;
  const transkripRows = db.prepare(`SELECT COUNT(*) c FROM transkrip`).get().c;
  t('kelas tetap draft setelah kegagalan', kelasStatus === 'draft' && nilaiDraft === 3 && transkripRows === 0);

  // ===== PENDING: lanjut mode B setelah service transkrip hidup =====
  console.log('MODE_A_SELESAI');
  console.log(out.join('\n'));
})();
