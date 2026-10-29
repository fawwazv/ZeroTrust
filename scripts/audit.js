// npm run audit — cetak 20 audit log terakhir dalam bentuk tabel
require('dotenv').config();
const { connect } = require('../db/connection');

const db = connect();
const rows = db
  .prepare(`SELECT id, timestamp, subject, method, endpoint, device_id, decision, reason FROM audit_log ORDER BY id DESC LIMIT 20`)
  .all();

if (rows.length === 0) {
  console.log('audit_log kosong.');
} else {
  console.log(`20 audit log terakhir (total ${db.prepare('SELECT COUNT(*) c FROM audit_log').get().c} baris):`);
  console.table(rows);
}
