#!/usr/bin/env node
/* ============================================================
   Einmalige Übernahme der Daten: Supabase → MySQL
   ============================================================
   Aufruf (im Ordner chroniken-discord-proxy):

     MYSQL_URL="mysql://user:pass@host:3306/db" MYSQL_SSL=1 \
     SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_KEY="<publishable oder secret key>" \
     node scripts/migrate-supabase-to-mysql.js [--dry-run] [--overwrite]

   Alternativ aus einer Datei (Export aus dem Supabase Table Editor
   als JSON: [{ "key": "...", "value": ... }, ...]):

     node scripts/migrate-supabase-to-mysql.js --file export.json

   Standard: Schlüssel, die in MySQL schon Daten enthalten, werden
   übersprungen. Mit --overwrite werden sie ersetzt.
   --dry-run zeigt nur, was passieren würde.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const db = require(path.join(__dirname, '..', 'db.js'));

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };

async function readSupabase() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (!base || !key) throw new Error('SUPABASE_URL und SUPABASE_KEY setzen (oder --file export.json nutzen).');
  const r = await fetch(base + '/rest/v1/chroniken_data?select=key,value', {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()));
  return r.json();
}

function isEmpty(v) {
  return v == null || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

(async () => {
  const file = opt('--file');
  const rows = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : await readSupabase();
  if (!Array.isArray(rows)) throw new Error('Unerwartetes Format: erwartet wird ein Array aus { key, value }.');

  const existing = flag('--dry-run') && !db.configured() ? {} : await db.getAll();
  const report = { imported: [], skipped: [], unknown: [], invalid: [] };
  const entries = [];

  // Alte camelCase-Zeilen zuerst, damit die aktuellen snake_case-Zeilen sie bei Doppelten überschreiben
  const ordered = rows.slice().sort((a, b) => (db.normalizeKey(a.key) === a.key) - (db.normalizeKey(b.key) === b.key));
  for (const row of ordered) {
    const key = db.normalizeKey(row.key);               // alte camelCase-Namen werden umbenannt
    let value = row.value;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch {} }
    if (!db.KEYS[key]) { report.unknown.push(row.key); continue; }
    if (!db.validValue(key, value)) { report.invalid.push(row.key); continue; }
    if (!flag('--overwrite') && !isEmpty(existing[key])) { report.skipped.push(key); continue; }
    if (isEmpty(value) && !isEmpty(existing[key])) { report.skipped.push(key); continue; }
    const dup = entries.findIndex(e => e.key === key);
    if (dup >= 0) {
      if (isEmpty(value)) continue;               // leere Doppelgänger verdrängen keine Daten
      entries.splice(dup, 1);
      report.imported.splice(report.imported.findIndex(x => x.startsWith(key + ' (')), 1);
    }
    entries.push({ key, value });
    report.imported.push(key + ' (' + (Array.isArray(value) ? value.length + ' Einträge' : 'Objekt') + ')');
  }

  if (!flag('--dry-run') && entries.length) await db.setMany(entries);

  console.log(flag('--dry-run') ? '--- Testlauf, nichts geschrieben ---' : '--- Fertig ---');
  console.log('Übernommen :', report.imported.join(', ') || '–');
  console.log('Übersprungen (MySQL hat schon Daten):', report.skipped.join(', ') || '–');
  if (report.unknown.length) console.log('Unbekannte Schlüssel (ignoriert):', report.unknown.join(', '));
  if (report.invalid.length) console.log('Ungültiger Typ (ignoriert):', report.invalid.join(', '));
  process.exit(0);
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
