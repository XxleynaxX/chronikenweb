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
async function ensureAdminSchema() {
  if (adminSchemaPromise) return adminSchemaPromise;
  adminSchemaPromise = (async () => {
    const p = getPool();
    await ensureSchema();
    await p.query(ADMIN_TASK_SCHEMA);
    await p.query(ADMIN_TASKS_SCHEMA);
    await p.query(ADMIN_COMMENTS_SCHEMA);
    await p.query(ADMIN_BLACKLIST_SCHEMA);
    await p.query(ADMIN_CHANGELOG_SCHEMA);
    await p.query(ADMIN_ACTIVITY_SCHEMA);
    await seedAdminChangelog();
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
  if(!/^\d{10,20}$/.test(steamId)) throw Object.assign(new Error('Ungültige Steam-ID.'),{status:400});
  try {
    const [r]=await getPool().query('INSERT INTO admin_blacklist (steam_id,player_name,reason,created_by) VALUES (?,?,?,?)',[steamId,String(data.player_name||'').trim().slice(0,255),String(data.reason||'').trim().slice(0,5000),actor]);
    await adminActivity(actor,'blacklist.added',null,null,steamId);
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
  return true;
}
async function isSteamBlacklisted(steamId) {
  const id=String(steamId||'').trim();
  if(!id) return false;
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT id,steam_id,player_name,reason FROM admin_blacklist WHERE steam_id=? LIMIT 1',[id]);
  return rows[0] || null;
}
async function checkCharacterBlacklist(value) {
  if(!Array.isArray(value)) return null;
  const seen=new Set();
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
  return adminTask(r.insertId);
}
async function adminUpdateTask(id, task, actor) {
  await ensureAdminSchema();
  await getPool().query(`UPDATE admin_tasks SET title=?,description=?,project_id=?,assigned_discord_id=?,status=?,priority=?,due_date=NULLIF(?,'' ) WHERE id=?`,[
    task.title,task.description||'',task.project_id||null,task.assigned_discord_id||null,task.status||'open',task.priority||'normal',task.due_date||'',id
  ]);
  await adminActivity(actor,'task.updated',id,null,JSON.stringify({status:task.status,priority:task.priority}));
  return adminTask(id);
}
async function adminDeleteTask(id, actor) {
  await ensureAdminSchema();
  await getPool().query('DELETE FROM admin_tasks WHERE id=?',[id]);
  await adminActivity(actor,'task.deleted',id,null,'');
}
async function adminProjects() {
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT * FROM admin_projects ORDER BY status, name'); return rows;
}
async function adminCreateProject(p, actor) {
  await ensureAdminSchema();
  const [r]=await getPool().query('INSERT INTO admin_projects (name,description,status,created_by) VALUES (?,?,?,?)',[p.name,p.description||'',p.status||'active',actor]);
  await adminActivity(actor,'project.created',null,r.insertId,p.name); return r.insertId;
}
async function adminUpdateProject(id,p,actor) {
  await ensureAdminSchema();
  await getPool().query('UPDATE admin_projects SET name=?,description=?,status=? WHERE id=?',[p.name,p.description||'',p.status||'active',id]);
  await adminActivity(actor,'project.updated',null,id,p.name);
}
async function adminDeleteProject(id,actor) {
  await ensureAdminSchema();
  await getPool().query('DELETE FROM admin_projects WHERE id=?',[id]);
  await adminActivity(actor,'project.deleted',null,id,'');
}
async function adminAddComment(taskId, discordId, comment) {
  await ensureAdminSchema();
  await getPool().query('INSERT INTO admin_task_comments (task_id,discord_id,comment) VALUES (?,?,?)',[taskId,discordId,comment]);
  await adminActivity(discordId,'task.comment',taskId,null,comment.slice(0,500));
}
async function adminActivity(discordId, action, taskId, projectId, details) {
  await getPool().query('INSERT INTO admin_activity (discord_id,action,task_id,project_id,details) VALUES (?,?,?,?,?)',[discordId,action,taskId||null,projectId||null,details||'']);
}
async function adminActivities(limit=100) {
  await ensureAdminSchema();
  const [rows]=await getPool().query('SELECT * FROM admin_activity ORDER BY created_at DESC LIMIT ?',[Math.min(Math.max(Number(limit)||100,1),200)]);
  return rows;
}

module.exports = {
  KEYS, normalizeKey, canWrite, validValue,
  configured, ensureSchema, getAll, getOne, setMany, claimNotificationKey, status, ensureAdminSchema, adminSummary, adminTasks, adminTask, adminCreateTask, adminUpdateTask, adminDeleteTask, adminProjects, adminCreateProject, adminUpdateProject, adminDeleteProject, adminAddComment, adminActivities, adminBlacklist, adminBlacklistEntry, adminAddBlacklist, adminRemoveBlacklist, isSteamBlacklisted, adminChangelog
};
