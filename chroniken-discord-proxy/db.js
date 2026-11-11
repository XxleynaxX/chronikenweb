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
  moon:              { label: 'Mond',                   description: 'Mondphasen und Zyklus-Zustand (Objekt)',               type: 'object', write: 'admin' },
  characters:        { label: 'Charakter-Register',     description: 'Öffentliches Charakter-Register',                        type: 'array',  write: 'public' },
  character_sheets:  { label: 'Charakterbögen',         description: 'Ausgefüllte Charakterbögen',                             type: 'array',  write: 'public' },
  healer_records:    { label: 'Heilerakten',            description: 'Medizinische RP-Aufzeichnungen',                         type: 'array',  write: 'healer' },
  map:               { label: 'Karte',                  description: 'Kartenmarker und Orte',                                  type: 'array',  write: 'lib' },
  admin_projects:       { label: 'Admin · Projekte',        description: 'Projekte der Administration',                       type: 'array', write: 'admin' },
  admin_tasks:          { label: 'Admin · Aufgaben',        description: 'Aufgaben der Administration',                       type: 'array', write: 'admin' },
  admin_task_comments:  { label: 'Admin · Kommentare',      description: 'Kommentare zu Admin-Aufgaben',                     type: 'array', write: 'admin' },
  admin_activity:       { label: 'Admin · Aktivitäten',     description: 'Aktivitäten und Aktionen der Administration',       type: 'array', write: 'admin' },
  admin_blacklist:      { label: 'Admin · Blacklist',       description: 'Gesperrte Steam-IDs und Spieler',                    type: 'array', write: 'admin' },
  admin_changelog:      { label: 'Admin · Changelog',       description: 'Änderungen am Admin-System',                         type: 'array', write: 'admin' }
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
  const flag = String(process.env.MYSQL_SSL || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'disabled') return undefined;
  const ca = process.env.MYSQL_SSL_CA;
  if (ca) return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  // Jeder andere gesetzte Wert (1, true, on, required, …) schaltet TLS ein.
  if (flag) return { rejectUnauthorized: true };
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

const CREATE_NOTIFICATION_TABLE = `
  CREATE TABLE IF NOT EXISTS chroniken_notification_sent (
    notification_key VARCHAR(191) NOT NULL,
    sent_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (notification_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Idempotenz-Sperre für Discord-Benachrichtigungen'`;

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
    await p.query(CREATE_NOTIFICATION_TABLE);
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
  for (const { key, value } of entries) {
    if (key === 'characters' || key === 'character_sheets') {
      // Nur NEUE Steam-IDs prüfen. Bereits gespeicherte Einträge dürfen das
      // Speichern anderer Charaktere nicht blockieren (sonst geht nach dem
      // Sperren eines Spielers gar nichts mehr zu speichern).
      let known = new Set();
      try { known = steamIdSet(await getOne(key)); } catch (e) { console.warn('[DB] Bestand für Blacklist-Prüfung nicht lesbar:', e.message); }
      let hit = null;
      try {
        hit = await checkCharacterBlacklist(value, known);
      } catch (e) {
        // Fällt die Blacklist-Prüfung technisch aus, darf das Speichern nicht scheitern.
        console.error('[DB] Blacklist-Prüfung fehlgeschlagen (Speichern läuft weiter):', e.message);
      }
      if (hit) throw Object.assign(new Error('Dieser Spieler ist für neue Charaktere gesperrt. Steam-ID: ' + hit.steam_id), { status: 403, code: 'STEAM_BLACKLISTED' });
    }
  }
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

async function claimNotificationKey(key) {
  await ensureSchema();
  const [result] = await getPool().query('INSERT IGNORE INTO chroniken_notification_sent (notification_key) VALUES (?)', [String(key)]);
  return Number(result.affectedRows) === 1;
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


const ADMIN_TASK_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('active','paused','completed') NOT NULL DEFAULT 'active',
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ADMIN_TASKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  project_id INT NULL,
  assigned_discord_id VARCHAR(32) NULL,
  status ENUM('open','working','waiting','blocked','done') NOT NULL DEFAULT 'open',
  priority ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
  due_date DATETIME NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_admin_tasks_status(status),
  INDEX idx_admin_tasks_assigned(assigned_discord_id),
  INDEX idx_admin_tasks_due(due_date),
  CONSTRAINT fk_admin_task_project FOREIGN KEY (project_id) REFERENCES admin_projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ADMIN_COMMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_task_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  discord_id VARCHAR(32) NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_admin_comments_task(task_id),
  CONSTRAINT fk_admin_comment_task FOREIGN KEY (task_id) REFERENCES admin_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ADMIN_BLACKLIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_blacklist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  steam_id VARCHAR(32) NOT NULL UNIQUE,
  discord_id VARCHAR(32) NULL,
  discord_tag VARCHAR(255) NULL,
  player_name VARCHAR(255) NULL,
  reason TEXT NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_admin_blacklist_steam(steam_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ADMIN_CHANGELOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_changelog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'System',
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_admin_changelog_created(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ADMIN_ACTIVITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(32) NOT NULL,
  action VARCHAR(100) NOT NULL,
  task_id INT NULL,
  project_id INT NULL,
  details TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_admin_activity_created(created_at),
  INDEX idx_admin_activity_task(task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

let adminSchemaPromise = null;
async function syncAdminKeys() {
  // Relationale Admin-Tabellen bleiben erhalten; diese Keys spiegeln deren aktuellen Inhalt.
  await ensureSchema();
  const p = getPool();
  const queries = {
    admin_projects: 'SELECT * FROM admin_projects ORDER BY id DESC',
    admin_tasks: 'SELECT t.*, p.name AS project_name FROM admin_tasks t LEFT JOIN admin_projects p ON p.id=t.project_id ORDER BY t.id DESC',
    admin_task_comments: 'SELECT * FROM admin_task_comments ORDER BY id DESC',
    admin_activity: 'SELECT * FROM admin_activity ORDER BY id DESC',
    admin_blacklist: 'SELECT * FROM admin_blacklist ORDER BY id DESC',
    admin_changelog: 'SELECT * FROM admin_changelog ORDER BY id DESC'
  };
  for (const [key, sql] of Object.entries(queries)) {
    const [rows] = await p.query(sql);
    const meta = KEYS[key];
    await p.query(
      'INSERT INTO chroniken_data (`key`,`value`,label,description) VALUES (?,CAST(? AS JSON),?,?) ' +
      'ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), label=VALUES(label), description=VALUES(description)',
      [key, JSON.stringify(rows), meta.label, meta.description]
    );
  }
}
async function ensureBlacklistColumns() {
  const p = getPool();
  const [cols] = await p.query('SHOW COLUMNS FROM admin_blacklist');
  const names = new Set(cols.map(c => c.Field));
  if (!names.has('discord_id')) await p.query('ALTER TABLE admin_blacklist ADD COLUMN discord_id VARCHAR(32) NULL AFTER steam_id');
  if (!names.has('discord_tag')) await p.query('ALTER TABLE admin_blacklist ADD COLUMN discord_tag VARCHAR(255) NULL AFTER discord_id');
}

async function ensureAdminSchema() {
  if (adminSchemaPromise) return adminSchemaPromise;
  adminSchemaPromise = (async () => {
    const p = getPool();
    await ensureSchema();
    await p.query(ADMIN_TASK_SCHEMA);
    await p.query(ADMIN_TASKS_SCHEMA);
    await p.query(ADMIN_COMMENTS_SCHEMA);
    await p.query(ADMIN_BLACKLIST_SCHEMA);
    await ensureBlacklistColumns();
    await p.query(ADMIN_CHANGELOG_SCHEMA);
    await p.query(ADMIN_ACTIVITY_SCHEMA);
    await seedAdminChangelog();
    await syncAdminKeys();
  })().catch(e => { adminSchemaPromise = null; throw e; });
  return adminSchemaPromise;
}

async function seedAdminChangelog() {
  const p = getPool();
  const entries = [
    ['Admin-Dashboard erstellt','Zentrales Admin-Dashboard mit Aufgaben, Projekten, Team und Aktivitäten.','Admin-System'],
    ['Aufgabenverwaltung hinzugefügt','Aufgaben können erstellt, bearbeitet, priorisiert, zugewiesen und abgeschlossen werden.','Aufgaben'],
    ['Projekte hinzugefügt','Admin-Projekte können angelegt, pausiert und abgeschlossen werden.','Projekte'],
    ['Discord-Anbindung ergänzt','Discord-Teammitglieder und optionale Aufgaben-Benachrichtigungen wurden angebunden.','Discord'],
    ['MySQL-Speicherung ergänzt','Admin-Aufgaben, Projekte, Kommentare und Aktivitäten werden dauerhaft in MySQL gespeichert.','Datenbank'],
    ['Spieler-Blacklist vorbereitet','Gesperrte Steam-IDs werden serverseitig beim Charakter-Speichern geprüft.','Sicherheit']
  ];
  for (const [title,description,category] of entries) {
    const [rows] = await p.query('SELECT id FROM admin_changelog WHERE title=? LIMIT 1',[title]);
    if (!rows.length) await p.query('INSERT INTO admin_changelog (title,description,category,created_by) VALUES (?,?,?,?)',[title,description,category,'system']);
  }
}

async function adminBlacklist() {
  await ensureAdminSchema();
  const [rows] = await getPool().query('SELECT * FROM admin_blacklist ORDER BY created_at DESC');
  return rows;
}
async function adminBlacklistEntry(id) {
  await ensureAdminSchema();
  const [rows] = await getPool().query('SELECT * FROM admin_blacklist WHERE id=?',[id]);
  return rows[0] || null;
}
async function adminAddBlacklist(data, actor) {
  await ensureAdminSchema();
  const steamId=String(data.steam_id||'').trim();
  const discordId=String(data.discord_id||'').trim();
  const discordTag=String(data.discord_tag||'').trim().slice(0,255);
  if(!/^\d{10,20}$/.test(steamId)) throw Object.assign(new Error('Ungültige Steam-ID.'),{status:400});
  if(discordId && !/^\d{15,22}$/.test(discordId)) throw Object.assign(new Error('Ungültige Discord-ID.'),{status:400});
  if(!discordId && !discordTag) throw Object.assign(new Error('Discord-ID oder Discord-Tag muss angegeben werden.'),{status:400});
  try {
    const [r]=await getPool().query('INSERT INTO admin_blacklist (steam_id,discord_id,discord_tag,player_name,reason,created_by) VALUES (?,?,?,?,?,?)',[steamId,discordId||null,discordTag||null,String(data.player_name||'').trim().slice(0,255),String(data.reason||'').trim().slice(0,5000),actor]);
    await adminActivity(actor,'blacklist.added',null,null,steamId);
    await syncAdminKeys();
    return adminBlacklistEntry(r.insertId);
  } catch(e) {
    if(e && e.code==='ER_DUP_ENTRY') throw Object.assign(new Error('Diese Steam-ID steht bereits auf der Blackliste.'),{status:409});
    throw e;
  }
}
async function adminRemoveBlacklist(id, actor) {
  await ensureAdminSchema();
  const entry=await adminBlacklistEntry(id);
  if(!entry) return false;
  await getPool().query('DELETE FROM admin_blacklist WHERE id=?',[id]);
  await adminActivity(actor,'blacklist.removed',null,null,entry.steam_id);
  await syncAdminKeys();
  return true;
}
async function isSteamBlacklisted(steamId) {
  const id=String(steamId||'').trim();
  if(!id) return false;
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT id,steam_id,discord_id,discord_tag,player_name,reason FROM admin_blacklist WHERE steam_id=? LIMIT 1',[id]);
  return rows[0] || null;
}
async function isDiscordBlacklisted(discordId, discordTag) {
  const id=String(discordId||'').trim();
  const tag=String(discordTag||'').trim();
  if(!id && !tag) return null;
  await ensureAdminSchema();
  const [rows]=await getPool().query(
    'SELECT id,steam_id,discord_id,discord_tag,player_name,reason FROM admin_blacklist WHERE (discord_id IS NOT NULL AND discord_id=?) OR (discord_tag IS NOT NULL AND LOWER(discord_tag)=LOWER(?)) LIMIT 1',
    [id,tag]
  );
  return rows[0] || null;
}
function steamIdOf(entry){
  if(!entry || typeof entry!=='object') return '';
  return String(entry.steamId ?? entry.steamID ?? entry.steam_id ?? '').trim();
}
function steamIdSet(list){
  const set=new Set();
  if(Array.isArray(list)) for(const e of list){ const id=steamIdOf(e); if(id) set.add(id); }
  return set;
}
async function checkCharacterBlacklist(value, known) {
  if(!Array.isArray(value)) return null;
  const seen=new Set(known || []);
  for(const entry of value){
    if(!entry || typeof entry!=='object') continue;
    const id=String(entry.steamId ?? entry.steamID ?? entry.steam_id ?? '').trim();
    if(!id || seen.has(id)) continue;
    seen.add(id);
    const hit=await isSteamBlacklisted(id);
    if(hit) return hit;
  }
  return null;
}
async function adminChangelog(limit=30) {
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT * FROM admin_changelog ORDER BY created_at DESC LIMIT ?',[Math.min(Math.max(Number(limit)||30,1),100)]);
  return rows;
}

async function adminSummary() {
  await ensureAdminSchema();
  const [rows] = await getPool().query(`
    SELECT
      COUNT(*) total,
      SUM(status='open') open_count,
      SUM(status='working') working_count,
      SUM(status='waiting') waiting_count,
      SUM(status='blocked') blocked_count,
      SUM(status='done') done_count,
      SUM(status <> 'done' AND due_date IS NOT NULL AND due_date < NOW()) overdue_count
    FROM admin_tasks`);
  return rows[0];
}
async function adminTasks(filters = {}) {
  await ensureAdminSchema();
  const where=[]; const params=[];
  if (filters.status) { where.push('t.status=?'); params.push(filters.status); }
  if (filters.assigned) { where.push('t.assigned_discord_id=?'); params.push(filters.assigned); }
  const sql=`SELECT t.*, p.name project_name
    FROM admin_tasks t LEFT JOIN admin_projects p ON p.id=t.project_id
    ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY CASE t.status WHEN 'blocked' THEN 1 WHEN 'working' THEN 2 WHEN 'open' THEN 3 WHEN 'waiting' THEN 4 ELSE 5 END,
             t.due_date IS NULL, t.due_date, t.updated_at DESC`;
  const [rows]=await getPool().query(sql,params); return rows;
}
async function adminTask(id) {
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT t.*, p.name project_name FROM admin_tasks t LEFT JOIN admin_projects p ON p.id=t.project_id WHERE t.id=?',[id]);
  if(!rows.length)return null;
  const [comments]=await getPool().query('SELECT * FROM admin_task_comments WHERE task_id=? ORDER BY created_at ASC',[id]);
  return {...rows[0],comments};
}
async function adminCreateTask(task, actor) {
  await ensureAdminSchema();
  const [r]=await getPool().query(`INSERT INTO admin_tasks (title,description,project_id,assigned_discord_id,status,priority,due_date,created_by)
    VALUES (?,?,?,?,?,?,NULLIF(?,''),?)`,[
      task.title,task.description||'',task.project_id||null,task.assigned_discord_id||null,
      task.status||'open',task.priority||'normal',task.due_date||'',actor
    ]);
  await adminActivity(actor,'task.created',r.insertId,null,task.title);
  await syncAdminKeys();
  return adminTask(r.insertId);
}
async function adminUpdateTask(id, task, actor) {
  await ensureAdminSchema();
  await getPool().query(`UPDATE admin_tasks SET title=?,description=?,project_id=?,assigned_discord_id=?,status=?,priority=?,due_date=NULLIF(?,'' ) WHERE id=?`,[
    task.title,task.description||'',task.project_id||null,task.assigned_discord_id||null,task.status||'open',task.priority||'normal',task.due_date||'',id
  ]);
  await adminActivity(actor,'task.updated',id,null,JSON.stringify({status:task.status,priority:task.priority}));
  await syncAdminKeys();
  return adminTask(id);
}
async function adminDeleteTask(id, actor) {
  await ensureAdminSchema();
  await getPool().query('DELETE FROM admin_tasks WHERE id=?',[id]);
  await adminActivity(actor,'task.deleted',id,null,'');
  await syncAdminKeys();
}
async function adminProjects() {
  await ensureAdminSchema();
  const [rows]=await getPool().query(`
    SELECT p.*,
      COUNT(t.id) AS task_count,
      COALESCE(SUM(t.status='done'),0) AS done_count,
      COALESCE(SUM(t.status='working'),0) AS working_count,
      COALESCE(SUM(t.status='open'),0) AS open_count
    FROM admin_projects p
    LEFT JOIN admin_tasks t ON t.project_id=p.id
    GROUP BY p.id
    ORDER BY p.status, p.name
  `);
  return rows.map(r => ({...r,
    task_count:Number(r.task_count)||0,
    done_count:Number(r.done_count)||0,
    working_count:Number(r.working_count)||0,
    open_count:Number(r.open_count)||0
  }));
}
async function adminCreateProject(p, actor) {
  await ensureAdminSchema();
  const [r]=await getPool().query('INSERT INTO admin_projects (name,description,status,created_by) VALUES (?,?,?,?)',[p.name,p.description||'',p.status||'active',actor]);
  await adminActivity(actor,'project.created',null,r.insertId,p.name); await syncAdminKeys(); return r.insertId;
}
async function adminUpdateProject(id,p,actor) {
  await ensureAdminSchema();
  await getPool().query('UPDATE admin_projects SET name=?,description=?,status=? WHERE id=?',[p.name,p.description||'',p.status||'active',id]);
  await adminActivity(actor,'project.updated',null,id,p.name); await syncAdminKeys();
}
async function adminDeleteProject(id,actor) {
  await ensureAdminSchema();
  await getPool().query('DELETE FROM admin_projects WHERE id=?',[id]);
  await adminActivity(actor,'project.deleted',null,id,''); await syncAdminKeys();
}
async function adminAddComment(taskId, discordId, comment) {
  await ensureAdminSchema();
  await getPool().query('INSERT INTO admin_task_comments (task_id,discord_id,comment) VALUES (?,?,?)',[taskId,discordId,comment]);
  await adminActivity(discordId,'task.comment',taskId,null,comment.slice(0,500));
  await syncAdminKeys();
}
async function adminActivity(discordId, action, taskId, projectId, details) {
  await getPool().query('INSERT INTO admin_activity (discord_id,action,task_id,project_id,details) VALUES (?,?,?,?,?)',[discordId,action,taskId||null,projectId||null,details||'']);
}
async function adminActivities(limit=100) {
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT * FROM admin_activity ORDER BY created_at DESC LIMIT ?',[Math.min(Math.max(Number(limit)||100,1),200)]);
  return rows;
}



/* ===== Tagebuch ===== */
const DIARY_ENTRIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS diary_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  char_id VARCHAR(32) NOT NULL,
  discord_id VARCHAR(32) NOT NULL,
  discord_name VARCHAR(255) NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  entry_date DATE NOT NULL,
  admin_seen TINYINT(1) NOT NULL DEFAULT 0,
  user_seen_comments TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_diary_char(char_id),
  INDEX idx_diary_discord(discord_id),
  INDEX idx_diary_date(entry_date),
  INDEX idx_diary_admin_seen(admin_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const DIARY_COMMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS diary_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_id INT NOT NULL,
  discord_id VARCHAR(32) NOT NULL,
  author_name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_diary_comments_entry(entry_id),
  CONSTRAINT fk_diary_comment_entry FOREIGN KEY (entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

let diarySchemaPromise = null;
async function ensureDiarySchema() {
  if (!diarySchemaPromise) {
    diarySchemaPromise = (async () => {
      await ensureSchema();
      const p = getPool();
      await p.query(DIARY_ENTRIES_SCHEMA);
      await p.query(DIARY_COMMENTS_SCHEMA);
    })();
  }
  return diarySchemaPromise;
}

function normalizeCharId(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (/^\d+$/.test(s)) s = 'CH-' + s.padStart(4, '0');
  if (/^CH\d+$/.test(s)) s = 'CH-' + s.slice(2).padStart(4, '0');
  if (!/^CH-\d{1,8}$/.test(s)) {
    const err = new Error('Ungültige Charakter-ID (Format: CH-0001)');
    err.status = 400;
    throw err;
  }
  // normalize padding to 4+
  const num = s.slice(3);
  return 'CH-' + num.padStart(Math.max(4, num.length), '0');
}

function diaryDeepValues(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) { for (const item of value) diaryDeepValues(item, out); return out; }
  if (typeof value !== 'object') { out.push(String(value)); return out; }
  for (const v of Object.values(value)) diaryDeepValues(v, out);
  return out;
}

function diaryFindCharId(character, normalizer) {
  for (const value of diaryDeepValues(character)) {
    const text = String(value || '').trim();
    if (/^CH-?\d{1,8}$/i.test(text) || /^\d{1,8}$/.test(text)) {
      try { return normalizer(text); } catch {}
    }
  }
  return '';
}

async function diaryBindDiscordIdentity(characters, character, discordId, discordTags) {
  if (!character || !discordId) return;
  const id = String(discordId).trim();
  const tags = Array.isArray(discordTags) ? discordTags.map(v => String(v || '').trim()).filter(Boolean) : [];
  const next = { ...character };
  let changed = false;
  if (!next.discord_id) { next.discord_id = id; changed = true; }
  if (!next.discordUsername && tags[0]) { next.discordUsername = tags[0]; changed = true; }
  if (!next.discordTag && tags[1]) { next.discordTag = tags[1]; changed = true; }
  if (!changed) return;
  const index = characters.indexOf(character);
  if (index < 0) return;
  const updated = characters.slice();
  updated[index] = next;
  try {
    const conn = await getPool().getConnection();
    try {
      await conn.query('INSERT INTO chroniken_data (`key`, `value`, label, description) VALUES (?, CAST(? AS JSON), ?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        ['characters', JSON.stringify(updated), KEYS.characters.label, KEYS.characters.description]);
    } finally { conn.release(); }
  } catch (e) {
    console.warn('[DIARY] Discord-Zuordnung konnte nicht in characters ergänzt werden:', e.message);
  }
}

async function diaryCharacterForDiscord(discordId, discordTag, requestedCharId = '') {
  await ensureDiarySchema();
  const wantedId = String(discordId || '').trim();
  const normalizeDiscordName = value => String(value || '').trim().replace(/^@/, '').toLowerCase();
  const wantedTags = (Array.isArray(discordTag) ? discordTag : [discordTag]).map(normalizeDiscordName).filter(Boolean);
  const characters = await getOne('characters');
  const list = Array.isArray(characters) ? characters : [];
  const idKeys = ['discord_id','discordId','discord_user_id','discordUserId','owner_id','ownerId','player_id','playerId','user_id','userId'];
  const tagKeys = ['discordName','discord_name','discordTag','discord_tag','discordUsername','discord_username','discordUser','discord_user','discordAccount','discord_account'];
  const getCharId = c => diaryFindCharId(c, normalizeCharId);
  const deepTagMatch = (c, tags) => diaryDeepValues(c).some(v => tags.includes(normalizeDiscordName(v)));

  if (requestedCharId) {
    const wantedChar = normalizeCharId(requestedCharId);
    for (const c of list) {
      if (!c || typeof c !== 'object' || getCharId(c) !== wantedChar) continue;
      const ids = idKeys.flatMap(k => { const v = c[k]; return Array.isArray(v) ? v.map(String) : (v == null ? [] : [String(v)]); });
      const names = tagKeys.flatMap(k => { const v = c[k]; return Array.isArray(v) ? v : (v == null ? [] : [v]); }).map(normalizeDiscordName);
      const ownsById = !!wantedId && ids.some(v => String(v).trim() === wantedId);
      const ownsByName = wantedTags.some(tag => names.includes(tag)) || wantedTags.some(tag => deepTagMatch(c.data, [tag]));
      if (ownsById || ownsByName) { await diaryBindDiscordIdentity(list, c, wantedId, discordTag); return wantedChar; }
      const err = new Error('CH ' + wantedChar + ' wurde gefunden, gehört aber nicht zu deinem Discord-Konto.'); err.status = 403; throw err;
    }
    const err = new Error('CH ' + wantedChar + ' wurde in der Datenbank nicht gefunden.'); err.status = 404; throw err;
  }
  if (!wantedId && !wantedTags.length) return null;
  if (wantedId) {
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const ids = idKeys.flatMap(k => { const v = c[k]; return Array.isArray(v) ? v.map(String) : (v == null ? [] : [String(v)]); });
      if (ids.includes(wantedId)) return getCharId(c) || null;
    }
  }
  if (wantedTags.length) {
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const names = tagKeys.flatMap(k => { const v = c[k]; return Array.isArray(v) ? v : (v == null ? [] : [v]); }).map(normalizeDiscordName);
      if (wantedTags.some(tag => names.includes(tag))) { const charId = getCharId(c) || null; await diaryBindDiscordIdentity(list, c, wantedId, discordTag); return charId; }
    }
  }
  return null;
}
async function diaryCreateEntry(data) {
  await ensureDiarySchema();
  const charId = normalizeCharId(data.char_id);
  const text = String(data.text || '').trim();
  if (!text) {
    const err = new Error('Eintragstext ist Pflicht');
    err.status = 400;
    throw err;
  }
  const title = String(data.title || '').trim().slice(0, 255);
  let entryDate = data.entry_date ? String(data.entry_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) entryDate = new Date().toISOString().slice(0, 10);
  const [r] = await getPool().query(
    'INSERT INTO diary_entries (char_id, discord_id, discord_name, title, body, entry_date, admin_seen, user_seen_comments) VALUES (?,?,?,?,?,?,0,1)',
    [charId, String(data.discord_id), String(data.discord_name || '').slice(0, 255), title, text, entryDate]
  );
  return diaryGetEntry(r.insertId);
}

async function diaryDeleteEntry(id) {
  await ensureDiarySchema();
  const entry = await diaryGetEntry(id);
  if (!entry) {
    const err = new Error('Eintrag nicht gefunden');
    err.status = 404;
    throw err;
  }
  await getPool().query('DELETE FROM diary_entries WHERE id=?', [Number(id)]);
  return true;
}

async function diaryGetEntry(id) {
  await ensureDiarySchema();
  const [rows] = await getPool().query('SELECT * FROM diary_entries WHERE id=?', [id]);
  return rows[0] || null;
}

async function diaryListByDiscord(discordId, charId) {
  await ensureDiarySchema();
  let sql = `SELECT e.*,
    (SELECT COUNT(*) FROM diary_comments c WHERE c.entry_id=e.id) AS comment_count,
    (SELECT COUNT(*) FROM diary_comments c WHERE c.entry_id=e.id AND e.user_seen_comments=0) AS new_comment_flag
    FROM diary_entries e WHERE e.discord_id=?`;
  const params = [String(discordId)];
  if (charId) {
    sql += ' AND e.char_id=?';
    params.push(normalizeCharId(charId));
  }
  sql += ' ORDER BY e.entry_date DESC, e.id DESC';
  const [rows] = await getPool().query(sql, params);
  return rows.map(r => ({
    ...r,
    comment_count: Number(r.comment_count) || 0,
    has_new_comments: !r.user_seen_comments && (Number(r.comment_count) || 0) > 0
  }));
}

async function diaryListByChar(charId) {
  await ensureDiarySchema();
  const id = normalizeCharId(charId);
  const [rows] = await getPool().query(
    `SELECT e.*,
      (SELECT COUNT(*) FROM diary_comments c WHERE c.entry_id=e.id) AS comment_count
     FROM diary_entries e WHERE e.char_id=?
     ORDER BY e.entry_date DESC, e.id DESC`,
    [id]
  );
  return rows.map(r => ({
    ...r,
    comment_count: Number(r.comment_count) || 0,
    is_new: !r.admin_seen
  }));
}

async function diaryAdminUsers() {
  await ensureDiarySchema();
  const [rows] = await getPool().query(
    `SELECT char_id,
            MAX(discord_name) AS discord_name,
            MAX(discord_id) AS discord_id,
            COUNT(*) AS entry_count,
            SUM(CASE WHEN admin_seen=0 THEN 1 ELSE 0 END) AS new_count,
            MAX(entry_date) AS last_date
     FROM diary_entries
     GROUP BY char_id
     ORDER BY new_count DESC, last_date DESC, char_id ASC`
  );
  return rows.map(r => ({
    ...r,
    entry_count: Number(r.entry_count) || 0,
    new_count: Number(r.new_count) || 0
  }));
}

async function diaryListOrphanEntries() {
  await ensureDiarySchema();
  const [rows] = await getPool().query(
    `SELECT e.*,
      (SELECT COUNT(*) FROM diary_comments c WHERE c.entry_id=e.id) AS comment_count
     FROM diary_entries e
     WHERE e.char_id IS NULL OR TRIM(e.char_id)=''
     ORDER BY e.entry_date DESC, e.id DESC`
  );
  return rows.map(r => ({
    ...r,
    comment_count: Number(r.comment_count) || 0,
    is_new: !r.admin_seen
  }));
}

async function diaryDeleteOrphanEntries() {
  await ensureDiarySchema();
  const [r] = await getPool().query(
    `DELETE FROM diary_entries
     WHERE char_id IS NULL OR TRIM(char_id)=''`
  );
  return Number(r.affectedRows) || 0;
}

async function diaryListComments(entryId) {
  await ensureDiarySchema();
  const [rows] = await getPool().query(
    'SELECT * FROM diary_comments WHERE entry_id=? ORDER BY created_at ASC',
    [entryId]
  );
  return rows;
}

async function diaryAddComment(data) {
  await ensureDiarySchema();
  const entryId = Number(data.entry_id);
  const text = String(data.text || '').trim();
  if (!entryId || !text) {
    const err = new Error('entry_id und text sind Pflicht');
    err.status = 400;
    throw err;
  }
  const entry = await diaryGetEntry(entryId);
  if (!entry) {
    const err = new Error('Eintrag nicht gefunden');
    err.status = 404;
    throw err;
  }
  const [r] = await getPool().query(
    'INSERT INTO diary_comments (entry_id, discord_id, author_name, body) VALUES (?,?,?,?)',
    [entryId, String(data.discord_id), String(data.author_name || 'Admin').slice(0, 255), text]
  );
  // User soll "New Kommentar" sehen
  await getPool().query('UPDATE diary_entries SET user_seen_comments=0, admin_seen=1 WHERE id=?', [entryId]);
  const [rows] = await getPool().query('SELECT * FROM diary_comments WHERE id=?', [r.insertId]);
  return rows[0];
}

async function diaryUpdateComment(id, text, actorDiscordId) {
  await ensureDiarySchema();
  const body = String(text || '').trim();
  if (!body) {
    const err = new Error('Kommentar darf nicht leer sein');
    err.status = 400;
    throw err;
  }
  await getPool().query('UPDATE diary_comments SET body=?, updated_at=CURRENT_TIMESTAMP(3) WHERE id=?', [body, id]);
}

async function diaryDeleteComment(id) {
  await ensureDiarySchema();
  await getPool().query('DELETE FROM diary_comments WHERE id=?', [id]);
}

async function diaryMarkAdminRead(entryId) {
  await ensureDiarySchema();
  if (!entryId) return;
  await getPool().query('UPDATE diary_entries SET admin_seen=1 WHERE id=?', [Number(entryId)]);
}

async function diaryMarkUserRead(entryId, discordId) {
  await ensureDiarySchema();
  await getPool().query(
    'UPDATE diary_entries SET user_seen_comments=1 WHERE id=? AND discord_id=?',
    [Number(entryId), String(discordId)]
  );
}

module.exports = {
  KEYS, normalizeKey, canWrite, validValue,
  configured, ensureSchema, getAll, getOne, setMany, claimNotificationKey, status, ensureAdminSchema, syncAdminKeys, adminSummary, adminTasks, adminTask, adminCreateTask, adminUpdateTask, adminDeleteTask, adminProjects, adminCreateProject, adminUpdateProject, adminDeleteProject, adminAddComment, adminActivities, adminBlacklist, adminBlacklistEntry, adminAddBlacklist, adminRemoveBlacklist, isSteamBlacklisted, isDiscordBlacklisted, adminChangelog,
  ensureDiarySchema, diaryCharacterForDiscord, diaryCreateEntry, diaryGetEntry, diaryDeleteEntry, diaryListByDiscord, diaryListByChar, diaryAdminUsers, diaryListOrphanEntries, diaryDeleteOrphanEntries, diaryListComments, diaryAddComment, diaryUpdateComment, diaryDeleteComment, diaryMarkAdminRead, diaryMarkUserRead
};
