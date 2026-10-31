/* ============================================================
   Chroniken – MySQL-Anbindung (ersetzt Supabase)
   ============================================================
   Verbindung per Umgebungsvariablen (Render → Environment):
     MYSQL_URL        mysql://user:pass@host:3306/datenbank   (oder einzeln:)
     MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
     MYSQL_SSL        "1" (Standard bei Cloud-Anbietern) | "0" ohne TLS
     MYSQL_SSL_CA     optional: PEM-Zertifikat des Anbieters (statt Standard-CAs)
   Die Tabelle wird beim Start automatisch angelegt (siehe mysql-schema.sql).
   ============================================================ */
'use strict';

const mysql = require('mysql2/promise');

/**
 * Wer darf welchen Schlüssel schreiben?
 *   public  → jeder, auch ohne Login (Spieler legen Charaktere/Geburtstage an)
 *   lib     → Rolle Bibliothek oder Admin
 *   healer  → Rolle Heiler oder Admin
 *   admin   → nur Admins
 * Gelesen werden darf alles öffentlich (wie bisher).
 */
const KEYS = {
  races:             { label: 'Völker',                 description: 'Spielbare Rassen / Völker mit Subrassen und Attributen', type: 'array',  write: 'admin' },
  professions:       { label: 'Berufe',                 description: 'Berufe und Handwerke der Welt',                          type: 'array',  write: 'admin' },
  gods:              { label: 'Götter',                 description: 'Pantheon und göttliche Wesen',                           type: 'array',  write: 'admin' },
  creatures:         { label: 'Kreaturen',              description: 'Monster, Tiere und mythische Wesen',                     type: 'array',  write: 'admin' },
  wiki:              { label: 'Wiki',                   description: 'Wiki-Einträge und Lore-Texte',                           type: 'array',  write: 'admin' },
  library:           { label: 'Bibliothek',             description: 'Bücher und Schriften',                                   type: 'array',  write: 'lib' },
  rules:             { label: 'Regeln',                 description: 'Server- und RP-Regeln',                                  type: 'array',  write: 'admin' },
  news:              { label: 'News',                   description: 'Ankündigungen und Neuigkeiten',                          type: 'array',  write: 'admin' },
  events:            { label: 'Events',                 description: 'RP-Events und Termine',                                  type: 'array',  write: 'public' },
  character_events:  { label: 'Charakter-Events',       description: 'Persönliche Events der Charaktere',                      type: 'array',  write: 'public' },
  birthdays:         { label: 'Geburtstage',            description: 'Geburtstage der Charaktere',                             type: 'array',  write: 'public' },
  calendar:          { label: 'Kalender',               description: 'Eigene Kalendereinträge',                                type: 'array',  write: 'admin' },
  disabled_holidays: { label: 'Deaktivierte Feiertage', description: 'Feiertage die ausgeblendet werden',                      type: 'array',  write: 'admin' },
  weather:           { label: 'Wetter',                 description: 'Aktuelles Fantasy-Wetter (Objekt)',                      type: 'object', write: 'admin' },
  characters:        { label: 'Charakter-Register',     description: 'Öffentliches Charakter-Register',                        type: 'array',  write: 'public' },
  character_sheets:  { label: 'Charakterbögen',         description: 'Ausgefüllte Charakterbögen',                             type: 'array',  write: 'public' },
  healer_records:    { label: 'Heilerakten',            description: 'Medizinische RP-Aufzeichnungen',                         type: 'array',  write: 'healer' },
  map:               { label: 'Karte',                  description: 'Kartenmarker und Orte',                                  type: 'array',  write: 'lib' }
};

// Alte camelCase-Namen (aus früheren Versionen) → aktuelle Schlüssel
const LEGACY_KEYS = {
  characterEvents: 'character_events',
  disabledHolidays: 'disabled_holidays',
  characterSheets: 'character_sheets'
};

function normalizeKey(k) {
  const key = String(k || '');
  return LEGACY_KEYS[key] || key;
}

function canWrite(key, session) {
  const rule = KEYS[key] && KEYS[key].write;
  if (!rule) return false;
  if (rule === 'public') return true;
  if (!session) return false;
  if (session.admin) return true;
  if (rule === 'lib') return !!session.lib;
  if (rule === 'healer') return !!session.healer;
  return false;
}

function validValue(key, value) {
  const type = KEYS[key].type;
  if (type === 'array') return Array.isArray(value);
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------- Verbindung ----------
let pool = null;

function sslOption() {
  const flag = String(process.env.MYSQL_SSL || '').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return undefined;
  const ca = process.env.MYSQL_SSL_CA;
  if (ca) return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  // Ohne explizite Angabe: nur mit TLS, wenn MYSQL_SSL gesetzt ist.
  if (flag === '1' || flag === 'true' || flag === 'on') return { rejectUnauthorized: true };
  return undefined;
}

function configured() {
  return !!(process.env.MYSQL_URL || (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE));
}

function getPool() {
  if (pool) return pool;
  if (!configured()) {
    throw new Error('MySQL nicht eingerichtet: MYSQL_URL (oder MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE) fehlt.');
  }
  const common = {
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 5,
    connectTimeout: 15000,
    charset: 'utf8mb4',
    ssl: sslOption(),
    // Render/Cloud-DBs trennen ruhende Verbindungen gern – Keep-Alive hilft.
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000
  };
  if (process.env.MYSQL_URL) {
    pool = mysql.createPool({ uri: process.env.MYSQL_URL, ...common });
  } else {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ...common
    });
  }
  return pool;
}

// ---------- Schema ----------
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS chroniken_data (
    \`key\`       VARCHAR(64)  NOT NULL COMMENT 'Technischer Schlüssel (z. B. races, events)',
    \`value\`     JSON         NOT NULL COMMENT 'Daten als JSON (Array oder Objekt)',
    label       VARCHAR(100) NULL     COMMENT 'Anzeigename',
    description VARCHAR(255) NULL     COMMENT 'Kurze Beschreibung',
    updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`key\`),
    KEY chroniken_data_updated_at_idx (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Zentrale RP-Daten der Chroniken (Key-Value mit JSON)'`;

const CREATE_VIEW = `
  CREATE OR REPLACE VIEW chroniken_overview AS
  SELECT \`key\`, label, description,
         CASE JSON_TYPE(\`value\`)
           WHEN 'ARRAY'  THEN CONCAT(JSON_LENGTH(\`value\`), ' Einträge')
           WHEN 'OBJECT' THEN 'Objekt'
           ELSE '–'
         END AS preview,
         updated_at, created_at
  FROM chroniken_data
  ORDER BY label, \`key\``;

let schemaPromise = null;

function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const p = getPool();
    await p.query(CREATE_TABLE);
    // Bekannte Schlüssel anlegen; vorhandene Werte bleiben unangetastet.
    for (const [key, k] of Object.entries(KEYS)) {
      const empty = k.type === 'object' ? '{}' : '[]';
      await p.query(
        'INSERT INTO chroniken_data (`key`, `value`, label, description) VALUES (?, CAST(? AS JSON), ?, ?) ' +
        'ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description)',
        [key, empty, k.label, k.description]
      );
    }
    try { await p.query(CREATE_VIEW); } catch (e) { console.warn('[DB] Übersicht-View nicht angelegt:', e.message); }
    console.log('[DB] MySQL bereit (' + Object.keys(KEYS).length + ' Schlüssel).');
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

// MySQL liefert JSON-Spalten bereits geparst, MariaDB als Text.
function parseValue(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  if (Buffer.isBuffer(v)) { try { return JSON.parse(v.toString('utf8')); } catch { return null; } }
  return v;
}

// ---------- Zugriff ----------
async function getAll() {
  await ensureSchema();
  const [rows] = await getPool().query('SELECT `key`, `value` FROM chroniken_data ORDER BY `key`');
  const data = {};
  for (const r of rows) data[r.key] = parseValue(r.value);
  return data;
}

async function getOne(key) {
  await ensureSchema();
  const [rows] = await getPool().query('SELECT `value` FROM chroniken_data WHERE `key` = ?', [key]);
  return rows.length ? parseValue(rows[0].value) : null;
}

/** Mehrere Schlüssel in einer Transaktion schreiben: [{ key, value }] */
async function setMany(entries) {
  await ensureSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const { key, value } of entries) {
      await conn.query(
        'INSERT INTO chroniken_data (`key`, `value`, label, description) VALUES (?, CAST(? AS JSON), ?, ?) ' +
        'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [key, JSON.stringify(value), KEYS[key].label, KEYS[key].description]
      );
    }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

async function status() {
  await ensureSchema();
  const [rows] = await getPool().query(
    'SELECT `key`, updated_at, ' +
    "CASE JSON_TYPE(`value`) WHEN 'ARRAY' THEN JSON_LENGTH(`value`) ELSE NULL END AS entries " +
    'FROM chroniken_data ORDER BY `key`'
  );
  return rows;
}

module.exports = {
  KEYS, normalizeKey, canWrite, validValue,
  configured, ensureSchema, getAll, getOne, setMany, status
};
