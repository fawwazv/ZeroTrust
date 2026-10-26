-- [ZT] Skema SQLite bersama untuk Policy Engine, Service Nilai, dan Service Transkrip
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nama          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nim           TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  device_id  TEXT NOT NULL,
  label      TEXT,
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS kelas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_mk   TEXT NOT NULL,
  nama_mk   TEXT NOT NULL,
  dosen_id  INTEGER NOT NULL REFERENCES users(id),
  status    TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final'))
);

CREATE TABLE IF NOT EXISTS nilai (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id      INTEGER NOT NULL REFERENCES kelas(id),
  mahasiswa_id  INTEGER NOT NULL REFERENCES users(id),
  nilai_angka   REAL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  UNIQUE (kelas_id, mahasiswa_id)
);

CREATE TABLE IF NOT EXISTS transkrip (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nim          TEXT NOT NULL,
  kelas_id     INTEGER NOT NULL,
  kode_mk      TEXT NOT NULL,
  nama_mk      TEXT NOT NULL,
  nilai_angka  REAL NOT NULL,
  nilai_huruf  TEXT NOT NULL,
  synced_at    TEXT NOT NULL,
  UNIQUE (nim, kelas_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  device_id   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_clients (
  client_id    TEXT PRIMARY KEY,
  secret_hash  TEXT NOT NULL,
  nama         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  subject_type  TEXT NOT NULL,
  method        TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  device_id     TEXT,
  decision      TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  reason        TEXT NOT NULL,
  ip            TEXT
);
