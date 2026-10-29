// [ZT] policy.js: Policy Engine (PE) — tabel kebijakan Tabel 5.2 + evaluate().
// Default deny: route tidak terdaftar, role salah, kepemilikan salah, status final,
// jam akses, atau penyalahgunaan token service/single token user — semua ditolak
// dengan reason baku. Keputusan data-driven dengan atribut dari DB.
const { isWithinAccessHours } = require('./access-hours');

// routing table (path dipakai pipeline + kebijakan; params diambil dari regex)
const ROUTES = [
  { method: 'GET', re: /^\/nilai$/, kind: 'nilai_get', roles: ['mahasiswa', 'dosen'] },
  { method: 'PUT', re: /^\/nilai\/(\d+)$/, kind: 'nilai_put', roles: ['dosen'] },
  { method: 'POST', re: /^\/kelas\/(\d+)\/finalisasi$/, kind: 'kelas_finalisasi', roles: ['dosen'] },
  { method: 'GET', re: /^\/transkrip\/([^/]+)$/, kind: 'transkrip_get', roles: ['mahasiswa', 'admin'] },
  { method: 'POST', re: /^\/transkrip\/sinkron$/, kind: 'sinkron', roles: ['service'] },
];

function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method === method) {
      const m = path.match(r.re);
      if (m) return { route: r, params: m.slice(1) };
    }
  }
  return null;
}

function deny(reason, status) {
  return { decision: 'deny', reason, status };
}

function allow() {
  return { decision: 'allow', reason: 'allowed', status: 200 };
}

// payload: { sub, role, typ } hasil verify generik; query: URLSearchParams
function evaluate(db, { method, path, payload, query }) {
  const m = matchRoute(method, path);
  if (!m) return deny('route_not_defined', 403);
  const { route, params } = m;

  // [ZT] Token service HANYA untuk POST /transkrip/sinkron (PRD 5.2 aturan tambahan)
  if (payload.typ === 'service') {
    if (route.kind !== 'sinkron') return deny('service_token_not_allowed', 403);
    return allow();
  }
  // [ZT] Endpoint khusus service dipanggil token user -> ditolak
  if (route.kind === 'sinkron') return deny('service_token_required', 403);

  // role
  if (!route.roles.includes(payload.role)) return deny('role_not_allowed', 403);

  const hourCheck = () => isWithinAccessHours();

  switch (route.kind) {
    case 'nilai_get': {
      // mahasiswa: selalu allow miliknya (saringan di service)
      if (payload.role === 'dosen' && query.get('kelas_id')) {
        const kelas = db.prepare(`SELECT * FROM kelas WHERE id = ?`).get(query.get('kelas_id'));
        if (!kelas) return deny('resource_not_found', 404);
        if (kelas.dosen_id !== payload.sub) return deny('not_class_owner', 403);
      }
      return allow();
    }
    case 'nilai_put': {
      // [ZT] urutan: nilai ada (404) -> pemilik -> belum final -> jam akses
      const nilai = db
        .prepare(`SELECT n.*, k.dosen_id AS dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?`)
        .get(params[0]);
      if (!nilai) return deny('resource_not_found', 404);
      if (nilai.dosen_id !== payload.sub) return deny('not_class_owner', 403);
      if (nilai.status === 'final') return deny('grade_already_final', 403);
      const h = hourCheck();
      if (!h.ok) return deny(h.reason, 403);
      return allow();
    }
    case 'kelas_finalisasi': {
      const kelas = db.prepare(`SELECT * FROM kelas WHERE id = ?`).get(params[0]);
      if (!kelas) return deny('resource_not_found', 404);
      if (kelas.dosen_id !== payload.sub) return deny('not_class_owner', 403);
      if (kelas.status === 'final') return deny('class_already_final', 403);
      const h = hourCheck();
      if (!h.ok) return deny(h.reason, 403);
      return allow();
    }
    case 'transkrip_get': {
      // mahasiswa hanya NIM miliknya (dibandingkan dari users.nim milik sub)
      if (payload.role === 'mahasiswa') {
        const self = db.prepare(`SELECT nim FROM users WHERE id = ?`).get(payload.sub);
        if (!self || self.nim !== params[0]) return deny('not_own_data', 403);
      }
      return allow();
    }
  }
  return deny('route_not_defined', 403);
}

module.exports = { evaluate, matchRoute };
