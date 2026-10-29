// [ZT] routes.js Service Nilai: GET /nilai, PUT /nilai/:id, POST /kelas/:id/finalisasi.
// Scoping data berdasarkan identitas token, BUKAN berdasarkan kepala siapa pun.
const express = require('express');
const { sinkronTranskrip } = require('./transkrip-client');

module.exports = (db) => {
  const r = express.Router();

  // [ZT] Helper: validasi role sebelum menyentuh data
  function requireRole(user, roles) {
    if (!roles.includes(user.role)) return { ok: false, reason: 'role_not_allowed', status: 403 };
    return { ok: true };
  }

  // GET /nilai  (?kelas_id opsional)
  // mahasiswa: selalu hanya nilai miliknya; dosen: hanya kelas yang diampu
  r.get('/nilai', (req, res) => {
    const user = req.user;
    const roleCheck = requireRole(user, ['mahasiswa', 'dosen']);
    if (!roleCheck.ok) return res.status(403).json({ error: roleCheck.reason, message: 'role tidak diizinkan' });

    const kelasId = req.query.kelas_id ? parseInt(req.query.kelas_id, 10) : null;
    if (user.role === 'mahasiswa') {
      // [ZT] filter paksa berdasarkan identitas token; kelas_id hanya penyaring
      const rows = kelasId
        ? db.prepare(
            `SELECT n.id, n.kelas_id, n.mahasiswa_id, u.nim, n.nilai_angka, n.status
             FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
             WHERE n.mahasiswa_id = ? AND n.kelas_id = ?`
          ).all(user.sub, kelasId)
        : db.prepare(
            `SELECT n.id, n.kelas_id, n.mahasiswa_id, u.nim, n.nilai_angka, n.status
             FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
             WHERE n.mahasiswa_id = ?`
          ).all(user.sub);
      return res.json({ data: rows });
    }

    // dosen
    if (kelasId) {
      const kelas = db.prepare(`SELECT * FROM kelas WHERE id = ?`).get(kelasId);
      if (!kelas) return res.status(404).json({ error: 'resource_not_found', message: 'kelas tidak ada' });
      if (kelas.dosen_id !== user.sub) {
        return res.status(403).json({ error: 'not_class_owner', message: 'kelas bukan diampu Anda' });
      }
    }
    const rows = kelasId
      ? db.prepare(
          `SELECT n.id, n.kelas_id, n.mahasiswa_id, u.nim, n.nilai_angka, n.status
           FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
           JOIN kelas k ON k.id = n.kelas_id
           WHERE k.dosen_id = ? AND n.kelas_id = ?`
        ).all(user.sub, kelasId)
      : db.prepare(
          `SELECT n.id, n.kelas_id, n.mahasiswa_id, u.nim, n.nilai_angka, n.status
           FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
           JOIN kelas k ON k.id = n.kelas_id
           WHERE k.dosen_id = ?`
        ).all(user.sub);
    return res.json({ data: rows });
  });

  // PUT /nilai/:id  body { nilai_angka: 0..100 }
  // Urutan: role -> nilai ada (404) -> pemilik kelas -> belum final
  r.put('/nilai/:id', (req, res) => {
    const user = req.user;
    const roleCheck = requireRole(user, ['dosen']);
    if (!roleCheck.ok) return res.status(403).json({ error: roleCheck.reason, message: 'hanya dosen' });

    const nilai = db
      .prepare(`SELECT n.*, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?`)
      .get(req.params.id);
    if (!nilai) return res.status(404).json({ error: 'resource_not_found', message: 'nilai tidak ada' });
    if (nilai.dosen_id !== user.sub) {
      return res.status(403).json({ error: 'not_class_owner', message: 'kelas bukan diampu Anda' });
    }
    if (nilai.status === 'final') {
      return res.status(403).json({ error: 'grade_already_final', message: 'nilai sudah final' });
    }

    // [ZT] Validasi rentang body di service (keputusan desain: 400 bila tak valid)
    const nilaiAngka = (req.body || {}).nilai_angka;
    if (typeof nilaiAngka !== 'number' || nilaiAngka < 0 || nilaiAngka > 100) {
      return res.status(400).json({ error: 'invalid_nilai_angka', message: 'nilai_angka harus angka 0..100' });
    }

    db.prepare(`UPDATE nilai SET nilai_angka = ? WHERE id = ?`).run(nilaiAngka, nilai.id);
    const updated = db.prepare(`SELECT * FROM nilai WHERE id = ?`).get(nilai.id);
    return res.json({ message: 'nilai diperbarui', data: updated });
  });

  // POST /kelas/:id/finalisasi
  // Urutan: role -> kelas ada (404) -> pemilik kelas -> kelas belum final
  r.post('/kelas/:id/finalisasi', async (req, res) => {
    const user = req.user;
    const roleCheck = requireRole(user, ['dosen']);
    if (!roleCheck.ok) return res.status(403).json({ error: roleCheck.reason, message: 'hanya dosen' });

    const kelas = db.prepare(`SELECT * FROM kelas WHERE id = ?`).get(req.params.id);
    if (!kelas) return res.status(404).json({ error: 'resource_not_found', message: 'kelas tidak ada' });
    if (kelas.dosen_id !== user.sub) {
      return res.status(403).json({ error: 'not_class_owner', message: 'kelas bukan diampu Anda' });
    }
    if (kelas.status === 'final') {
      return res.status(403).json({ error: 'class_already_final', message: 'kelas sudah final' });
    }

    // [ZT] Semua nilai kelas harus terisi; ada yang NULL -> 422, tidak memfinalisasi
    const kosong = db
      .prepare(`SELECT COUNT(*) c FROM nilai WHERE kelas_id = ? AND nilai_angka IS NULL`)
      .get(kelas.id).c;
    if (kosong > 0) {
      return res.status(422).json({ error: 'nilai_belum_lengkap', message: 'masih ada nilai yang kosong' });
    }

    // [ZT] Sinkron ke Service Transkrip MELALUI GATEWAY (bukan langsung ke :3002).
    const sinkron = await sinkronTranskrip(db, kelas.id);
    if (!sinkron.ok) {
      // [ZT] Sinkron gagal -> kelas TIDAK final, balas 502
      return res.status(502).json({ error: 'sinkron_transkrip_gagal', message: 'finalisasi dibatalkan: sinkron transkrip gagal' });
    }

    // [ZT] Sinkron sukses -> kelas + nilai ditandai final dalam SATU transaksi
    db.transaction(() => {
      db.prepare(`UPDATE kelas SET status = 'final' WHERE id = ?`).run(kelas.id);
      db.prepare(`UPDATE nilai SET status = 'final' WHERE kelas_id = ? AND status = 'draft'`).run(kelas.id);
    })();
    return res.json({ message: 'kelas difinalisasi', kelas_id: kelas.id, jumlah_nilai: sinkron.jumlah });
  });

  return r;
};
