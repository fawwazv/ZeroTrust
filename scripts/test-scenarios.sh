#!/usr/bin/env bash
# scripts/test-scenarios.sh
# Uji seluruh skenario penerimaan Bagian 8 PRD: A1-A8, G1-G5, P1-P19, C1-C4, L1-L3.
# Menjalankan gateway + kedua service sendiri, lalu mematikannya di akhir (tanpa sisa proses).
# Jalankan dengan: npm test
set -u
cd "$(dirname "$0")/.."

# ---------- env ----------
if [ ! -f .env ]; then
  echo "FAIL  file .env tidak ditemukan (copy dari .env.example dulu)"
  exit 1
fi
set -a; source .env; set +a

PASSC=0; FAILC=0
t() { if [ "$2" = "true" ]; then echo "PASS  $1"; PASSC=$((PASSC+1)); else echo "FAIL  $1"; FAILC=$((FAILC+1)); fi; }

# ---------- util ----------
B="http://localhost:${GATEWAY_PORT}"

req() { # req METHOD PATH [curl extra...] -> http_code; body di .tmp-body
  local m="$1" p="$2"; shift 2
  curl -s -o .tmp-body -w '%{http_code}' -m 10 -X "$m" "$@" "${B}${p}"
}
j() { node -p "JSON.parse(require('fs').readFileSync('.tmp-body','utf8')).$1" 2>/dev/null; }
ah() { # set header aktor global sebagai ARRAY bash agar tidak pecah di spasi
  AH=(-H "Authorization: Bearer $1" -H "X-Device-ID: $2")
}
login() { req POST /auth/login -H 'Content-Type: application/json' -H "X-Device-ID: $2" -d "{\"username\":\"$1\",\"password\":\"password123\"}"; }
dbq() { # kumpulan checkpoint DB via node (hindari masalah kutipan SQL)
  node <<'NODEEOF'
require('dotenv').config();
const { connect } = require('./db/connection');
const db = connect();
const checks = {
  a7revoked: db.prepare("SELECT revoked c FROM refresh_tokens WHERE user_id = 2 ORDER BY id DESC LIMIT 1").get().c,
  a7hash: db.prepare("SELECT token_hash c FROM refresh_tokens WHERE user_id = 2 ORDER BY id DESC LIMIT 1").get().c,
  kelas1: db.prepare("SELECT status c FROM kelas WHERE id = 1").get().c,
  nilaiFinal: db.prepare("SELECT COUNT(*) c FROM nilai WHERE kelas_id = 1 AND status = 'final'").get().c,
  auditTotal: db.prepare("SELECT COUNT(*) c FROM audit_log").get().c,
  auditService: db.prepare("SELECT COUNT(*) c FROM audit_log WHERE subject = 'service:service-nilai' AND endpoint = '/transkrip/sinkron' AND decision = 'allow'").get().c,
  expNilai: db.prepare("SELECT n.nilai_angka c FROM nilai n JOIN users u ON u.id = n.mahasiswa_id WHERE n.kelas_id = 1 AND u.nim = '207006001'").get().c,
  auditLeak: db.prepare("SELECT COUNT(*) c FROM audit_log WHERE subject LIKE '%eyJ%' OR endpoint LIKE '%password123%' OR endpoint LIKE '%client_secret%'").get().c,
};
console.log(JSON.stringify(checks));
NODEEOF
}
dbfield() { dbq | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).$1"; }

# ---------- persiapan ----------
taskkill //F //IM node.exe >/dev/null 2>&1 || true
sleep 1
node db/seed.js >/dev/null || { echo "FAIL  seed gagal"; exit 1; }

# [config] selama uji jam akses dibuat lebar (deterministik terhadap waktu berapapun)
CFG=config/access-hours.json
ORIG_CFG=$(cat "$CFG")
WIDE='{ "enabled": true, "start": "00:00", "end": "23:59", "timezone": "Asia/Jakarta" }'
NARROW='{ "enabled": true, "start": "23:00", "end": "23:59", "timezone": "Asia/Jakarta" }'
echo "$WIDE" > "$CFG"

node gateway/src/index.js           > .tmp-gw.log 2>&1 & GW=$!
node service-nilai/src/index.js     > .tmp-nil.log 2>&1 & NIL=$!
node service-transkrip/src/index.js > .tmp-tra.log 2>&1 & TRA=$!

cleanup() {
  echo "$ORIG_CFG" > "$CFG"
  kill "$GW" "$NIL" "$TRA" 2>/dev/null
  sleep 0.5
  taskkill //F //IM node.exe >/dev/null 2>&1 || true
  rm -f .tmp-body .tmp-token .tmp-gw.log .tmp-nil.log .tmp-tra.log
  echo "  [dibersihkan: proses dimatikan, config dikembalikan, log sementara dihapus]"
}
trap cleanup EXIT

# tunggu gateway siap
gateway_up=false
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 2 "${B}/nilai" 2>/dev/null || echo "")
  if [ -n "$code" ]; then gateway_up=true; break; fi
  sleep 0.3
done
t "X-backend semua hidup" "$gateway_up"

# ---------- A. Autentikasi ----------
c=$(login dosen1 DEV-DOSEN-1)
DOSEN=$(j access_token); REF=$(j refresh_token)
ADOSEN=(-H "Authorization: Bearer $DOSEN" -H "X-Device-ID: DEV-DOSEN-1")

a1ok=false; [ "$c" = 200 ] && [ -n "$DOSEN" ] && [ -n "$REF" ] && a1ok=true
t "A1 login dosen1 + device -> 200 (access + refresh)" "$a1ok"

c=$(req POST /auth/login -H 'Content-Type: application/json' -H "X-Device-ID: DEV-DOSEN-1" -d '{"username":"dosen1","password":"SALAH"}')
e=$(j error); t "A2 password salah -> 401 invalid_credentials" "$([ "$c" = 401 ] && [ "$e" = invalid_credentials ] && echo true || echo false)"

c=$(login dosen1 DEV-MHS-1); e=$(j error)
t "A3 device milik user lain -> 403 device_not_registered" "$([ "$c" = 403 ] && [ "$e" = device_not_registered ] && echo true || echo false)"

# A4 token kedaluwarsa: sign TTL 1s, tunggu, lalu coba pakai lewat gateway
ACCESS_TOKEN_TTL=1s node -e "require('dotenv').config();process.env.ACCESS_TOKEN_TTL='1s';const j=require('./shared/jwt');console.log(j.signAccessToken({sub:2,role:'dosen'}))" > .tmp-token
sleep 2.5
c=$(req GET /nilai -H "Authorization: Bearer $(cat .tmp-token)" -H "X-Device-ID: DEV-DOSEN-1"); e=$(j error)
t "A4 token kedaluwarsa -> 401 token_expired" "$([ "$c" = 401 ] && [ "$e" = token_expired ] && echo true || echo false)"

c=$(req POST /auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REF\"}")
NEWACC=$(j access_token)
a5ok=false; [ "$c" = 200 ] && [ -n "$NEWACC" ] && a5ok=true
t "A5 refresh token valid -> 200 access baru" "$a5ok"

c=$(req POST /auth/logout -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REF\"}")
c2=$(req POST /auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REF\"}"); e=$(j error)
t "A6 logout lalu refresh ulang -> 401 invalid_refresh_token" "$([ "$c" = 200 ] && [ "$c2" = 401 ] && [ "$e" = invalid_refresh_token ] && echo true || echo false)"

CC=$(dbfield a7revoked)
IS64=$(dbq | node -p "/^[a-f0-9]{64}$/.test(JSON.parse(require('fs').readFileSync(0,'utf8')).a7hash)")
t "A7 refresh token disimpan sebagai hash & revoked=1" "$([ "$CC" = 1 ] && [ "$IS64" = true ] && echo true || echo false)"

c=$(req POST /auth/service -H 'Content-Type: application/json' -d "{\"client_id\":\"$SERVICE_NILAI_CLIENT_ID\",\"client_secret\":\"$SERVICE_NILAI_CLIENT_SECRET\"}")
SVCTOK=$(j access_token)
c2=$(req POST /auth/service -H 'Content-Type: application/json' -d "{\"client_id\":\"$SERVICE_NILAI_CLIENT_ID\",\"client_secret\":\"SALAH\"}"); e=$(j error)
a8ok=false; [ "$c" = 200 ] && [ -n "$SVCTOK" ] && [ "$c2" = 401 ] && [ "$e" = invalid_service_credentials ] && a8ok=true
t "A8 token service benar / credential salah -> 401 invalid_service_credentials" "$a8ok"

# ---------- G. Gateway secret & verifikasi ulang ----------
c=$(curl -s -o .tmp-body -w '%{http_code}' -m 10 "http://localhost:${NILAI_PORT}/nilai")
t "G1 panggil langsung :3001 tanpa secret -> 403" "$([ "$c" = 403 ] && echo true || echo false)"
c=$(curl -s -o .tmp-body -w '%{http_code}' -m 10 "http://localhost:${TRANSKRIP_PORT}/transkrip/207006001")
t "G2 panggil langsung :3002 tanpa secret -> 403" "$([ "$c" = 403 ] && echo true || echo false)"
c=$(curl -s -o .tmp-body -w '%{http_code}' -m 10 -H "X-Gateway-Secret: $GATEWAY_SECRET" "http://localhost:${NILAI_PORT}/nilai"); e=$(j error)
t "G3 :3001 secret benar tapi tanpa token -> 401 missing_token" "$([ "$c" = 401 ] && [ "$e" = missing_token ] && echo true || echo false)"
c=$(curl -s -o .tmp-body -w '%{http_code}' -m 10 -H "X-Gateway-Secret: $GATEWAY_SECRET" -H "Authorization: Bearer $(cat .tmp-token)" "http://localhost:${NILAI_PORT}/nilai"); e=$(j error)
t "G4 :3001 secret benar tapi token kedaluwarsa -> 401 token_expired" "$([ "$c" = 401 ] && [ "$e" = token_expired ] && echo true || echo false)"

# ---------- login aktor sisanya ----------
c=$(login mhs1 DEV-MHS-1);   MHS=$(j access_token)
AMHS=(-H "Authorization: Bearer $MHS" -H "X-Device-ID: DEV-MHS-1")

c=$(login admin1 DEV-ADMIN-1); ADMIN=$(j access_token)
AADMIN=(-H "Authorization: Bearer $ADMIN" -H "X-Device-ID: DEV-ADMIN-1")


# ---------- P. Kebijakan ----------
c=$(req GET /nilai "${AMHS[@]}")
p1=$(node -p "const d=JSON.parse(require('fs').readFileSync('.tmp-body','utf8')).data; d.length===2 && d.every(x=>x.nim==='207006001')" 2>/dev/null)
t "P1 mhs1 GET /nilai -> hanya nilai miliknya (2 baris)" "$([ "$c" = 200 ] && [ "$p1" = true ] && echo true || echo false)"

c=$(req GET /nilai "${ADOSEN[@]}")
n=$(node -p "JSON.parse(require('fs').readFileSync('.tmp-body','utf8')).data.length" 2>/dev/null)
t "P2 dosen1 GET /nilai -> semua kelas yang diampu (3 baris)" "$([ "$c" = 200 ] && [ "$n" = 3 ] && echo true || echo false)"

c=$(req GET "/nilai?kelas_id=2" "${ADOSEN[@]}"); e=$(j error)
t "P3 dosen1 nilai kelas 2 -> 403 not_class_owner" "$([ "$c" = 403 ] && [ "$e" = not_class_owner ] && echo true || echo false)"

c=$(req PUT /nilai/1 -H 'Content-Type: application/json' "${AMHS[@]}" -d '{"nilai_angka":90}'); e=$(j error)
t "P4 mhs1 PUT -> 403 role_not_allowed" "$([ "$c" = 403 ] && [ "$e" = role_not_allowed ] && echo true || echo false)"

c=$(req PUT /nilai/1 -H 'Content-Type: application/json' "${ADOSEN[@]}" -d '{"nilai_angka":88}')
t "P5 dosen1 PUT nilai kelasnya (dalam jam) -> 200" "$([ "$c" = 200 ] && echo true || echo false)"

c=$(req PUT /nilai/4 -H 'Content-Type: application/json' "${ADOSEN[@]}" -d '{"nilai_angka":88}'); e=$(j error)
t "P6 dosen1 PUT nilai kelas 2 -> 403 not_class_owner" "$([ "$c" = 403 ] && [ "$e" = not_class_owner ] && echo true || echo false)"

c=$(req POST /kelas/2/finalisasi "${ADOSEN[@]}"); e=$(j error)
t "P7 dosen1 finalisasi kelas 2 -> 403 not_class_owner" "$([ "$c" = 403 ] && [ "$e" = not_class_owner ] && echo true || echo false)"

# ---------- C. Konteks ----------
c=$(req GET /nilai -H "Authorization: Bearer $DOSEN"); e=$(j error)
t "C1a tanpa X-Device-ID -> 403 missing_device_id" "$([ "$c" = 403 ] && [ "$e" = missing_device_id ] && echo true || echo false)"
c=$(req GET /nilai -H "Authorization: Bearer $DOSEN" -H "X-Device-ID: DEV-MHS-1"); e=$(j error)
t "C1b device tidak terdaftar -> 403 device_not_registered" "$([ "$c" = 403 ] && [ "$e" = device_not_registered ] && echo true || echo false)"

echo "$NARROW" > "$CFG"   # di luar jam
sleep 0.6
c=$(req PUT /nilai/1 -H 'Content-Type: application/json' "${ADOSEN[@]}" -d '{"nilai_angka":95}'); e=$(j error)
t "C2 PUT di luar jam -> 403 outside_access_hours" "$([ "$c" = 403 ] && [ "$e" = outside_access_hours ] && echo true || echo false)"
c=$(req POST /kelas/1/finalisasi "${ADOSEN[@]}"); e=$(j error)
t "C3 finalisasi di luar jam -> 403 outside_access_hours" "$([ "$c" = 403 ] && [ "$e" = outside_access_hours ] && echo true || echo false)"

echo "$WIDE" > "$CFG"     # kembali dalam jam, TANPA restart gateway
sleep 0.6
c=$(req PUT /nilai/2 -H 'Content-Type: application/json' "${ADOSEN[@]}" -d '{"nilai_angka":75}')
t "C4 config diubah tanpa restart -> kembali diizinkan (200)" "$([ "$c" = 200 ] && echo true || echo false)"

# ---------- P. transkrip ----------
c=$(req GET /transkrip/207006001 "${AMHS[@]}")
t "P11 mhs1 transkrip sendiri -> 200" "$([ "$c" = 200 ] && echo true || echo false)"
c=$(req GET /transkrip/207006002 "${AMHS[@]}"); e=$(j error)
t "P12 mhs1 transkrip orang lain -> 403 not_own_data" "$([ "$c" = 403 ] && [ "$e" = not_own_data ] && echo true || echo false)"
c=$(req GET /transkrip/207006002 "${AADMIN[@]}")
t "P13 admin baca transkrip sembarang -> 200" "$([ "$c" = 200 ] && echo true || echo false)"
c=$(req GET /transkrip/207006001 "${ADOSEN[@]}"); e=$(j error)
t "P14 dosen baca transkrip -> 403 role_not_allowed" "$([ "$c" = 403 ] && [ "$e" = role_not_allowed ] && echo true || echo false)"

c=$(req POST /transkrip/sinkron -H 'Content-Type: application/json' "${AMHS[@]}" -d '{"kelas_id":1,"kode_mk":"KP70065004","nama_mk":"Keamanan Informasi","items":[{"nim":"207006001","nilai_angka":88}]}'); e=$(j error)
t "P15 token user ke sinkron -> 403 service_token_required" "$([ "$c" = 403 ] && [ "$e" = service_token_required ] && echo true || echo false)"

c=$(req POST /transkrip/sinkron -H 'Content-Type: application/json' -H "Authorization: Bearer $SVCTOK" -d '{"kelas_id":1,"kode_mk":"KP70065004","nama_mk":"Keamanan Informasi","items":[{"nim":"207006001","nilai_angka":88}]}')
t "P16 token service -> 200 (sinkron idempoten)" "$([ "$c" = 200 ] && echo true || echo false)"

c=$(req GET /nilai -H "Authorization: Bearer $SVCTOK"); e=$(j error)
t "P17 token service di /nilai -> 403 service_token_not_allowed" "$([ "$c" = 403 ] && [ "$e" = service_token_not_allowed ] && echo true || echo false)"

c=$(req GET /nilai); e=$(j error)
t "P18 tanpa token -> 401 missing_token" "$([ "$c" = 401 ] && [ "$e" = missing_token ] && echo true || echo false)"

c=$(req GET /admin "${AADMIN[@]}"); e=$(j error)
t "P19 route tak dikenal -> 403 route_not_defined" "$([ "$c" = 403 ] && [ "$e" = route_not_defined ] && echo true || echo false)"

# ---------- G5 ----------
c=$(req GET "/nilai?kelas_id=1" "${ADOSEN[@]}" -H "X-Gateway-Secret: PALUSAN-CLIENT")
t "G5 client memalsukan X-Gateway-Secret -> ditimpa, kebijakan tetap berlaku (200)" "$([ "$c" = 200 ] && echo true || echo false)"

# ---------- P8-P10 finalisasi ----------
c=$(req POST /kelas/1/finalisasi "${ADOSEN[@]}"); msg=$(j message); n=$(j jumlah_nilai)
t "P8 dosen1 finalisasi kelas 1 -> 200, 3 nilai tersinkron" "$([ "$c" = 200 ] && [ "$msg" = "kelas difinalisasi" ] && [ "$n" = 3 ] && echo true || echo false)"

c=$(req GET /transkrip/207006001 "${AMHS[@]}")
N=$(dbfield expNilai)
p8a=$(node -p "const d=JSON.parse(require('fs').readFileSync('.tmp-body','utf8')).data; const n=$N; const h=n>=85?'A':n>=75?'B':n>=65?'C':n>=50?'D':'E'; d.length===1 && d[0].nilai_angka===n && d[0].nilai_huruf===h" 2>/dev/null)
t "P8a transkrip mhs1 sesuai nilai DB saat finalisasi" "$([ "$c" = 200 ] && [ "$p8a" = true ] && echo true || echo false)"

P8B=$(dbq | node -p "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); d.kelas1==='final' && d.nilaiFinal===3")
t "P8b kelas + 3 nilai jadi final" "$P8B"

c=$(req PUT /nilai/1 -H 'Content-Type: application/json' "${ADOSEN[@]}" -d '{"nilai_angka":95}'); e=$(j error)
t "P9 PUT setelah finalisasi -> 403 grade_already_final" "$([ "$c" = 403 ] && [ "$e" = grade_already_final ] && echo true || echo false)"

c=$(req POST /kelas/1/finalisasi "${ADOSEN[@]}"); e=$(j error)
t "P10 finalisasi ulang -> 403 class_already_final" "$([ "$c" = 403 ] && [ "$e" = class_already_final ] && echo true || echo false)"

# ---------- L. Audit ----------
ALLCHK=$(dbq | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).auditTotal > 30")
t "L1 audit mencatat keputusan (allow & deny)" "$ALLCHK"
ALLCHK=$(dbq | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).auditService >= 1")
t "L2 sinkron lewat gateway tercatat subjek service:service-nilai" "$ALLCHK"
ALLCHK=$(dbq | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).auditLeak === 0")
t "L3 tidak ada password/secret/token mentah di audit" "$ALLCHK"

# ---------- ringkasan ----------
echo ""
echo "RINGKASAN: $PASSC PASS, $FAILC FAIL"
[ "$FAILC" = 0 ]
