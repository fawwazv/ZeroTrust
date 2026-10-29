// [ZT] transkrip-client: Service Nilai memanggil Service Transkrip HANYA lewat
// gateway (bukan langsung ke :3002). Kredensial client dibaca dari env.
// Alur: ambil token service -> kumpulkan nilai kelas dari DB -> POST /transkrip/sinkron.
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const CLIENT_ID = process.env.SERVICE_NILAI_CLIENT_ID;
const CLIENT_SECRET = process.env.SERVICE_NILAI_CLIENT_SECRET;

async function ambilTokenService() {
  const res = await fetch(`${GATEWAY_URL}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return { ok: false, error: 'service_token_gagal', detail: await res.text() };
  const body = await res.json();
  return { ok: true, token: body.access_token };
}

// [ZT] kode_mk/nama_mk diambil dari tabel kelas sendiri (keputusan desain #3),
// NIM dari join users — data tidak diambil dari body dari mana pun.
async function sinkronTranskrip(db, kelasId) {
  try {
    const t = await ambilTokenService();
    if (!t.ok) return { ok: false, error: t.error };

    const kelas = db.prepare(`SELECT * FROM kelas WHERE id = ?`).get(kelasId);
    const items = db
      .prepare(
        `SELECT u.nim AS nim, n.nilai_angka AS nilai_angka
         FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
         WHERE n.kelas_id = ?`
      )
      .all(kelasId);

    const res = await fetch(`${GATEWAY_URL}/transkrip/sinkron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
      body: JSON.stringify({
        kelas_id: kelasId,
        kode_mk: kelas.kode_mk,
        nama_mk: kelas.nama_mk,
        items,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { ok: false, error: errBody.error || 'sinkron_gagal', detail: errBody.message || '' };
    }
    return { ok: true, jumlah: items.length };
  } catch (err) {
    return { ok: false, error: 'sinkron_gagal', detail: String(err && err.message || err) };
  }
}

module.exports = { sinkronTranskrip, ambilTokenService };
