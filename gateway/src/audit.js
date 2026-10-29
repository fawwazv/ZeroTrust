// [ZT] audit.js: tulis satu baris audit_log per keputusan akses (allow & deny).
// Tidak boleh menyimpan password, secret, atau token mentah.
const { connect } = require('../../db/connection');

let db;
function getDb() {
  if (!db) db = connect();
  return db;
}

// Semua argumen sudah bersih dari data sensitif; caller bertanggung jawab
function writeAudit({ subject, subjectType, method, endpoint, deviceId, decision, reason, ip }) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (timestamp, subject, subject_type, method, endpoint, device_id, decision, reason, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(new Date().toISOString(), subject, subjectType, method, endpoint, deviceId || null, decision, reason, ip || null);
}

// [ZT] Format subject baku: 'user:<id>:<username>' | 'service:<client_id>' | 'anonymous'
function userSubject(user) {
  return `user:${user.id}:${user.username}`;
}

module.exports = { writeAudit, userSubject };
