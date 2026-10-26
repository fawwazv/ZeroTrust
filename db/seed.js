// [ZT] Seed: reset penuh database lalu isi data awal sesuai PRD 4.2
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { connect } = require('./connection');

const db = connect();
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

db.exec(`
  DROP TABLE IF EXISTS audit_log;
  DROP TABLE IF EXISTS refresh_tokens;
  DROP TABLE IF EXISTS service_clients;
  DROP TABLE IF EXISTS transkrip;
  DROP TABLE IF EXISTS nilai;
  DROP TABLE IF EXISTS kelas;
  DROP TABLE IF EXISTS devices;
  DROP TABLE IF EXISTS users;
`);

db.exec(schema);

const insertUser = db.prepare(
  `INSERT INTO users (username, password_hash, nama, role, nim) VALUES (?, ?, ?, ?, ?)`
);
const insertDevice = db.prepare(
  `INSERT INTO devices (user_id, device_id, label) VALUES (?, ?, ?)`
);
const insertKelas = db.prepare(
  `INSERT INTO kelas (id, kode_mk, nama_mk, dosen_id, status) VALUES (?, ?, ?, ?, 'draft')`
);
const insertNilai = db.prepare(
  `INSERT INTO nilai (kelas_id, mahasiswa_id, nilai_angka, status) VALUES (?, ?, ?, 'draft')`
);

const passwordHash = bcrypt.hashSync('password123', 10);

const seed = db.transaction(() => {
  // users (password: password123 untuk semua akun seed)
  const idAdmin1 = insertUser.run('admin1', passwordHash, 'Admin Prodi', 'admin', null).lastInsertRowid;
  const idDosen1 = insertUser.run('dosen1', passwordHash, 'Dosen Satu', 'dosen', null).lastInsertRowid;
  const idDosen2 = insertUser.run('dosen2', passwordHash, 'Dosen Dua', 'dosen', null).lastInsertRowid;
  const idMhs1 = insertUser.run('mhs1', passwordHash, 'Mahasiswa Satu', 'mahasiswa', '207006001').lastInsertRowid;
  const idMhs2 = insertUser.run('mhs2', passwordHash, 'Mahasiswa Dua', 'mahasiswa', '207006002').lastInsertRowid;
  const idMhs3 = insertUser.run('mhs3', passwordHash, 'Mahasiswa Tiga', 'mahasiswa', '207006003').lastInsertRowid;

  // devices (1 device per user)
  insertDevice.run(idAdmin1, 'DEV-ADMIN-1', 'Laptop admin');
  insertDevice.run(idDosen1, 'DEV-DOSEN-1', 'Laptop dosen 1');
  insertDevice.run(idDosen2, 'DEV-DOSEN-2', 'Laptop dosen 2');
  insertDevice.run(idMhs1, 'DEV-MHS-1', 'Laptop mhs 1');
  insertDevice.run(idMhs2, 'DEV-MHS-2', 'Laptop mhs 2');
  insertDevice.run(idMhs3, 'DEV-MHS-3', 'Laptop mhs 3');

  // kelas
  insertKelas.run(1, 'KP70065004', 'Keamanan Informasi', idDosen1);
  insertKelas.run(2, 'KP70065005', 'Basis Data', idDosen2);

  // nilai draft
  insertNilai.run(1, idMhs1, 80);
  insertNilai.run(1, idMhs2, 70);
  insertNilai.run(1, idMhs3, 90);
  insertNilai.run(2, idMhs1, 85);
  insertNilai.run(2, idMhs3, 60);

  // service client (secret dari env, hash bcrypt)
  const clientId = process.env.SERVICE_NILAI_CLIENT_ID || 'service-nilai';
  const secret = process.env.SERVICE_NILAI_CLIENT_SECRET || 'ganti-dengan-secret-service';
  db.prepare(`INSERT INTO service_clients (client_id, secret_hash, nama) VALUES (?, ?, ?)`)
    .run(clientId, bcrypt.hashSync(secret, 10), 'Service Nilai');
});

seed();
db.close();

console.log('Seed selesai: database direset dan diisi data awal.');
