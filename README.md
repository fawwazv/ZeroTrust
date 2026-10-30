# Sistem Nilai — Zero Trust Security

Tugas praktikum mata kuliah Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.
Sistem Nilai dengan **API Gateway sebagai Policy Enforcement Point (PEP)** mengikuti NIST SP 800-207:
*never trust, always verify* (termasuk panggilan antar-service), *least privilege*, *assume breach*
(service selalu verifikasi ulang). Tanpa frontend; pengujian via curl/Postman.

```
Client ──► API Gateway :3000 (PEP + PE/PA) ──┬──► Service Nilai :3001 ──┐
   access + X-Device-ID        │             └──► Service Transkrip :3002 ─┤
                          policy + audit     (finalisasi → sinkron transkrip VIA gateway)
                                 └──────────► SQLite bersama (data/sistem-nilai.db)
```

## Prasyarat

- Node.js 18+ (dipakai di pengujian: Node 24)
- Git, npm

## Instalasi & Menjalankan

```bash
npm install
cp .env.example .env    # lalu isi JWT_SECRET, GATEWAY_SECRET, SERVICE_NILAI_CLIENT_SECRET dengan string acak
npm run seed            # reset database ke kondisi awal
npm run dev             # jalankan gateway (3000) + service nilai (3001) + transkrip (3002) bersamaan
```

- `npm run seed` — reset DB + isi data awal (bisa diulang kapan saja).
- `npm test` — jalankan **seluruh skenario penerimaan Bagian 8 PRD** (`scripts/test-scenarios.sh`);
  skrip menyalakan servernya sendiri, menjalankan 43 asersi PASS/FAIL, mematikan proses,
  mengembalikan `config/access-hours.json`, lalu membersihkan berkas sementara.
- `npm run audit` — tampilkan 20 audit log terakhir (untuk demo; lihat juga: set keputusan masuk log).

## Akun Seed (password semua akun: `password123`)

| username | role | NIM | Device ID terdaftar |
|---|---|---|---|
| `admin1` | admin | - | `DEV-ADMIN-1` |
| `dosen1` | dosen (pengampu kelas 1) | - | `DEV-DOSEN-1` |
| `dosen2` | dosen (pengampu kelas 2) | - | `DEV-DOSEN-2` |
| `mhs1` | mahasiswa | 207006001 | `DEV-MHS-1` |
| `mhs2` | mahasiswa | 207006002 | `DEV-MHS-2` |
| `mhs3` | mahasiswa | 207006003 | `DEV-MHS-3` |

Service client seed: `client_id = service-nilai`, secret dari env `SERVICE_NILAI_CLIENT_SECRET`.

## Mengubah Jam Akses (dipakai ulang tiap evaluasi, tanpa restart)

Edit `config/access-hours.json`:

```json
{ "enabled": true, "start": "07:00", "end": "21:00", "timezone": "Asia/Jakarta" }
```

Efek langsung untuk `PUT /nilai/:id` dan `POST /kelas/:id/finalisasi` (batas akhir eksklusif).
Untuk demo deny cepat, set rentang `23:00–23:59` lalu kembalikan.

## Contoh Skenario Utama (curl)

```bash
B=http://localhost:3000

# Login (dosen) — respons: access_token, refresh_token, token_type, expires_in
curl -X POST $B/auth/login -H "Content-Type: application/json" -H "X-Device-ID: DEV-DOSEN-1" \
     -d '{"username":"dosen1","password":"password123"}'

# Refresh / logout
curl -X POST $B/auth/refresh -H "Content-Type: application/json" -d '{"refresh_token":"<hex>"}'
curl -X POST $B/auth/logout  -H "Content-Type: application/json" -d '{"refresh_token":"<hex>"}'

# Token service (dipakai Service Nilai saat finalisasi)
curl -X POST $B/auth/service -H "Content-Type: application/json" \
     -d '{"client_id":"service-nilai","client_secret":"<SERVICE_NILAI_CLIENT_SECRET>"}'

# Lihat nilai (mahasiswa hanya miliknya; dosen hanya kelas diampunya)
curl $B/nilai -H "Authorization: Bearer <access_token>" -H "X-Device-ID: DEV-MHS-1"

# Ubah nilai (hanya dosen pemilik kelas, nilai belum final, dalam jam akses)
curl -X PUT $B/nilai/1 -H "Authorization: Bearer <token_dosen>" -H "X-Device-ID: DEV-DOSEN-1" \
     -H "Content-Type: application/json" -d '{"nilai_angka":88}'

# Finalisasi kelas (sinkron transkrip via gateway; 502 bila sinkron gagal)
curl -X POST $B/kelas/1/finalisasi -H "Authorization: Bearer <token_dosen>" -H "X-Device-ID: DEV-DOSEN-1"

# Lihat transkrip (mahasiswa: NIM sendiri; admin: semua)
curl $B/transkrip/207006001 -H "Authorization: Bearer <token_mhs>" -H "X-Device-ID: DEV-MHS-1"
```

Semua respons error: `{ "error": "<reason>", "message": "..." }` dengan reason baku Tabel 5.5 PRD.

## Peta Kebutuhan ke Kode (untuk demo)

| Kebutuhan | File utama |
|---|---|
| Login, refresh, logout, token service | `gateway/src/auth.js` |
| TTL access/service token dari env | `gateway/src/auth.js`, `shared/jwt.js` |
| Refresh token bisa dicabut (hash SHA-256) | `gateway/src/auth.js`, tabel `refresh_tokens` |
| Gateway PEP, pipeline pemeriksaan | `gateway/src/index.js`, `gateway/src/proxy.js` |
| Kebijakan allow/deny (Tabel 5.2) + maksimal data-driven | `gateway/src/policy.js` |
| Device terdaftar | `gateway/src/index.js` (pipeline), `gateway/src/auth.js` |
| Jam akses konfigurabel | `gateway/src/access-hours.js`, `config/access-hours.json` |
| Gateway secret + verifikasi ulang di service | `shared/gateway-secret.js`, `shared/jwt.js`, `service-*/src/index.js` |
| Panggilan antar-service via gateway | `service-nilai/src/transkrip-client.js` |
| Sinkron + konversi huruf + idempoten upsert | `service-transkrip/src/routes.js`, `nilai-huruf.js` |
| Audit log + viewer | `gateway/src/audit.js`, `scripts/audit.js` |
| Skenario uji lengkap | `scripts/test-scenarios.sh` |

## Keputusan Desain

Lihat `DECISIONS.md` (sudah disetujui, satu kalimat per keputusan). Ringkasan:
refresh token tidak dirotasi; device wajib hanya di `/auth/login`; validasi sinkron all-or-nothing
(payload invalid ditolak 422 tanpa menyimpan apa pun); finalisasi 502 bila sinkron gagal dan tidak memfinalisasi;
deny pra-policy tetap diaudit; `X-Gateway-Secret` client selalu ditimpa gateway.

**Catatan produksi (di luar scope tugas):** di lingkungan produksi lebih baik pakai kunci asimetrik
(RS256 via JWKS) daripada `JWT_SECRET` bersama; tugas ini sengaja memakai HS256 untuk kesederhanaan.

## Struktur

```
PRD.md  DECISIONS.md  README.md
config/access-hours.json       # jam akses (dibaca ulang tiap evaluasi)
db/ (schema.sql, seed.js, connection.js)
shared/ (jwt.js, gateway-secret.js)
gateway/src/ (index.js, auth.js, policy.js, access-hours.js, audit.js, proxy.js)
service-nilai/src/ (index.js, routes.js, transkrip-client.js)
service-transkrip/src/ (index.js, routes.js, nilai-huruf.js)
scripts/ (audit.js, test-scenarios.sh)
```
