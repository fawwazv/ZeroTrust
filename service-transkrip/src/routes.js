// [ZT] routes.js Service Transkrip: GET /transkrip/:nim dan POST /transkrip/sinkron.
// Receive ONLY the scoped data per token; sinkron upsert per (nim, kelas_id) + all-or-nothing payload validation.
const konversiHuruf = require('./nilai-huruf');

module.exports = {
  // GET /transkrip/:nim
  // mahasiswa: hanya NIM miliknya sendiri; admin: semua NIM; dosen: ditolak
  getTranskrip: (db) => (req, res) => {
    const user = req.user;
    const nim = req.params.nim;
    if (user.role === 'mahasiswa') {
      // [ZT] NIM dibandingkan terhadap milik token, bukan milik request
      const self = db.prepare(`SELECT nim FROM users WHERE id = ?`).get(user.sub);
      if (!self || self.nim !== nim) {
        return res.status(403).json({ error: 'not_own_data', message: 'nim bukan milik Anda' });
      }
    } else if (user.role !== 'admin') {
      return res.status(403).json({ error: 'role_not_allowed', message: 'role tidak diizinkan' });
    }
    const rows = db
      .prepare(`SELECT kode_mk, nama_mk, nilai_angka, nilai_huruf FROM transkrip WHERE nim = ? ORDER BY kode_mk`)
      .all(nim);
    return res.json({ nim, data: rows });
  },

  // POST /transkrip/sinkron — body { kelas_id, items: [{nim, nilai_angka}] }
  // Validasi ALL-OR-NOTHING: satu item saja invalid -> seluruh payload ditolak 422
  sinkron: (db) => (req, res) => {
    const body = req.body || {};
    const { kelas_id, kode_mk, nama_mk, items } = body;
    const kelasIdInt = parseInt(kelas_id, 10);

    if (!Number.isInteger(kelasIdInt) || !Array.isArray(items) || items.length === 0) {
      return res.status(422).json({ error: 'invalid_sync_payload', message: 'kelas_id dan items wajib dan tidak kosong' });
    }
    if (typeof kode_mk !== 'string' || !kode_mk || typeof nama_mk !== 'string' || !nama_mk) {
      return res.status(422).json({ error: 'invalid_sync_payload', message: 'kode_mk dan nama_mk wajib' });
    }
    // keputusan #4: kelas_id harus kelas yang benar-benar ada (punya data nilai)
    const kelasAda = db
      .prepare(`SELECT COUNT(*) c FROM nilai WHERE kelas_id = ?`)
      .get(kelasIdInt).c > 0;
    if (!kelasAda) {
      return res.status(422).json({ error: 'invalid_sync_payload', message: 'kelas_id tidak dikenal' });
    }

    const findNim = db.prepare(`SELECT id FROM users WHERE nim = ? AND role = 'mahasiswa'`);
    for (const item of items) {
      const { nim, nilai_angka } = item || {};
      if (!nim || !findNim.get(nim)) {
        return res.status(422).json({ error: 'invalid_sync_payload', message: `nim ${nim || '(kosong)'} tidak dikenal` });
      }
      if (typeof nilai_angka !== 'number' || nilai_angka < 0 || nilai_angka > 100) {
        return res.status(422).json({ error: 'invalid_sync_payload', message: 'nilai_angka harus angka 0..100' });
      }
    }

    // [ZT] Prepared statement + upsert idempoten per (nim, kelas_id)
    const upsert = db.prepare(
      `INSERT INTO transkrip (nim, kelas_id, kode_mk, nama_mk, nilai_angka, nilai_huruf, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(nim, kelas_id) DO UPDATE SET
         kode_mk = excluded.kode_mk,
         nama_mk = excluded.nama_mk,
         nilai_angka = excluded.nilai_angka,
         nilai_huruf = excluded.nilai_huruf,
         synced_at = excluded.synced_at`
    );

    // [ZT] Semua validasi sudah lolos -> satu transaksi per seluruh payload
    const now = new Date().toISOString();
    const sinkronTx = db.transaction(() => {
      for (const item of items) {
        // kode_mk/nama_mk diisi oleh Gateway; bukan dari client
        upsert.run(
          item.nim, kelasIdInt, kode_mk, nama_mk,
          item.nilai_angka, konversiHuruf(item.nilai_angka), now
        );
      }
    });
    sinkronTx();

    return res.json({ message: 'sinkron berhasil', kelas_id: kelasIdInt, jumlah: items.length });
  },
};
