// [ZT] access-hours.js: cek jam akses dari config/access-hours.json.
// Dibaca ulang SETIAP evaluasi agar perubahan berlaku tanpa restart (PRD 5.3).
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'access-hours.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { enabled: false };
  }
}

// now sebagai parameter agar mudah diuji; batas akhir EKSKLUSIF
// { ok: true } | { ok: false, reason: 'outside_access_hours' }
function isWithinAccessHours(now = new Date()) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { ok: true };

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.timezone || 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
  const minutes = get('hour') * 60 + get('minute');

  const [sh, sm] = String(cfg.start).split(':').map(Number);
  const [eh, em] = String(cfg.end).split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (minutes >= start && minutes < end) return { ok: true };
  return { ok: false, reason: 'outside_access_hours' };
}

module.exports = { isWithinAccessHours };
