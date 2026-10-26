// Helper koneksi SQLite bersama (PRAGMA WAL + foreign_keys)
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

function connect() {
  const dbPath = process.env.DB_PATH || './data/sistem-nilai.db';
  const crypto = require('fs');
  crypto.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { connect };
