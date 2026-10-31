const http = require('http');
const crypto = require('crypto');
const weather = require('./weather');
const moon = require('./mond');

const PORT = process.env.PORT || 3000;
const CHAR_WEBHOOK = process.env.CHAR_WEBHOOK || '';
const HEILER_WEBHOOK = process.env.HEILER_WEBHOOK || '';
const MOD_WEBHOOK = process.env.MOD_WEBHOOK || process.env.DISCORD_MOD_WEBHOOK || '';
const MOD_WATCHER_SECRET = process.env.MOD_WATCHER_SECRET || '';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || '';
const JSONBIN_EVENTS_BIN_ID = process.env.JSONBIN_EVENTS_BIN_ID || '6ae18121ffd5d1605391c7c7';
const JSONBIN_CHARS_BIN_ID = process.env.JSONBIN_CHARS_BIN_ID || '6ae17c9cffd5d1605391c27b';

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: 'Bearer ' + SUPABASE_SECRET_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

async function supabaseRest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_URL oder SUPABASE_SECRET_KEY fehlt.');
  }
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...supabaseHeaders(), ...(options.headers || {}) }
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (data?.message || text || 'unbekannter Fehler'));
  return data;
}

async function readJsonBin(binId) {
  if (!JSONBIN_MASTER_KEY) throw new Error('JSONBIN_MASTER_KEY fehlt.');
  const r = await fetch('https://api.jsonbin.io/v3/b/' + binId + '/latest', {
    headers: { 'X-Master-Key': JSONBIN_MASTER_KEY, 'X-Bin-Meta': 'false' }
  });
  const text = await r.text();
  if (!r.ok) throw new Error('JSONBin ' + r.status + ': ' + text);
  const data = JSON.parse(text);
  return data && data.record && typeof data.record === 'object' ? data.record : data;
}

function migrationToken(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function requireAdmin(req) {
  const p = verify(migrationToken(req));
  if (!p || !p.admin) throw new Error('Nur Admins dürfen die Datenmigration starten.');
  return p;
}

async function migrateJsonBinToSupabase() {
  const main = await readJsonBin(JSONBIN_EVENTS_BIN_ID);
  const chars = await readJsonBin(JSONBIN_CHARS_BIN_ID);

  const snapshot = {
    migrated_at: new Date().toISOString(),
    source: {
      events_bin_id: JSONBIN_EVENTS_BIN_ID,
      chars_bin_id: JSONBIN_CHARS_BIN_ID
    },
    main,
    chars
  };

  await supabaseRest('jsonbin_backups', {
    method: 'POST',
    body: JSON.stringify({ snapshot })
  });

  const arrays = {
    events: Array.isArray(main.events) ? main.events : [],
    birthdays: Array.isArray(main.birthdays) ? main.birthdays : [],
    calendar: Array.isArray(main.calendar) ? main.calendar : [],
    disabledHolidays: Array.isArray(main.disabledHolidays) ? main.disabledHolidays : [],
    characters: Array.isArray(chars.characters) ? chars.characters : [],
    characterSheets: Array.isArray(chars.characterSheets) ? chars.characterSheets : []
  };

  await supabaseRest('chroniken_data?on_conflict=key', {
    method: 'POST',
    body: JSON.stringify(Object.entries(arrays).map(([key, value]) => ({
      key,
      value,
      updated_at: new Date().toISOString()
    })))
  });

  return {
    ok: true,
    migrated_at: snapshot.migrated_at,
    counts: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, v.length]))
  };
}

/* ===== Discord-Login (OAuth2) =====
   Benötigte Umgebungsvariablen (Render → Environment):
   DISCORD_CLIENT_ID        Client-ID der Discord-Application
   DISCORD_CLIENT_SECRET    Client-Secret der Discord-Application
   AUTH_SECRET              lange zufällige Zeichenfolge (signiert die Login-Tokens)
   ALLOWED_RETURN_ORIGINS   Adresse(n) der Website, kommagetrennt, z. B. https://deinname.github.io
   Optional (haben Standardwerte):
   PUBLIC_URL, DISCORD_GUILD_ID, ADMIN_ROLE_IDS, LIB_ROLE_IDS, HEALER_ROLE_IDS, SESSION_HOURS
   Wetter-Meldung: DISCORD_WEATHER_WEBHOOK (siehe weather.js)
   Heilerakte-Meldung: HEILER_WEBHOOK (POST /heiler) */
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://chronikenweb-1.onrender.com').replace(/\/$/, '');
const GUILD_ID = process.env.DISCORD_GUILD_ID || '1204906165004279889';
const ADMIN_ROLES = (process.env.ADMIN_ROLE_IDS || process.env.ADMIN_ROLE_ID || process.env.DISCORD_ADMIN_ROLE_IDS || '1251121611130540063,1300216664113156116').split(',').map(s => s.trim()).filter(Boolean);
const LIB_ROLES = (process.env.LIB_ROLE_IDS || process.env.LIB_ROLE_ID || process.env.DISCORD_LIB_ROLE_IDS || '1564874876236472470').split(',').map(s => s.trim()).filter(Boolean);
const HEALER_ROLES = (process.env.HEALER_ROLE_IDS || process.env.HEALER_ROLE_ID || process.env.DISCORD_HEALER_ROLE_IDS || '1562596034243461150').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_RETURN_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const SESSION_MS = (Number(process.env.SESSION_HOURS) || 12) * 3600 * 1000;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!AUTH_SECRET || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function returnAllowed(url) {
  try { const u = new URL(url); return ALLOWED_ORIGINS.includes(u.origin) && /^https?:$/.test(u.protocol); }
  catch { return false; }
}
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function page(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function backWithError(res, ret, msg) {
  if (ret && returnAllowed(ret)) return redirect(res, ret + '#auth_error=' + encodeURIComponent(msg));
  page(res, 400, msg);
}

async function handleAuth(req, res, url) {
  // Aufwecken (Render schläft nach Inaktivität) – die Website ruft das im Hintergrund auf
  if (url.pathname === '/auth/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !AUTH_SECRET) {
    return page(res, 500, 'Discord-Login nicht eingerichtet: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET und AUTH_SECRET fehlen.');
  }
  const redirectUri = PUBLIC_URL + '/auth/callback';
  function discordAuthorizeUrl(ret) {
    const state = sign({ ret, n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60 * 1000 });
    const q = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri,
      scope: 'identify guilds.members.read', state, prompt: 'none'
    });
    return 'https://discord.com/oauth2/authorize?' + q;
  }

  // 1) Weiterleitung zu Discord
  if (url.pathname === '/auth/login') {
    const ret = url.searchParams.get('return') || '';
    if (!returnAllowed(ret)) return page(res, 400, 'Rückkehr-Adresse nicht erlaubt. ALLOWED_RETURN_ORIGINS prüfen.');
    return redirect(res, discordAuthorizeUrl(ret));
  }

  // 1b) Discord-Adresse als JSON (Website öffnet sie im Popup, ohne sichtbaren Umweg über Render)
  if (url.pathname === '/auth/start') {
    const ret = url.searchParams.get('return') || '';
    res.setHeader('Cache-Control', 'no-store');
    if (!returnAllowed(ret)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Rückkehr-Adresse nicht erlaubt. ALLOWED_RETURN_ORIGINS prüfen.' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, url: discordAuthorizeUrl(ret) }));
  }

  // 2) Rückkehr von Discord: Rollen prüfen, Token ausstellen
  if (url.pathname === '/auth/callback') {
    const st = verify(url.searchParams.get('state') || '');
    if (!st) return page(res, 400, 'Anmeldung abgelaufen. Bitte erneut versuchen.');
    const ret = st.ret;
    if (url.searchParams.get('error')) return backWithError(res, ret, 'Anmeldung abgebrochen.');
    const code = url.searchParams.get('code');
    if (!code) return backWithError(res, ret, 'Kein Code von Discord erhalten.');
    try {
      const tr = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code',
          code, redirect_uri: redirectUri
        })
      });
      if (!tr.ok) return backWithError(res, ret, 'Discord-Anmeldung fehlgeschlagen (Token).');
      const tok = await tr.json();
      const mr = await fetch('https://discord.com/api/users/@me/guilds/' + GUILD_ID + '/member', {
        headers: { Authorization: 'Bearer ' + tok.access_token }
      });
      if (mr.status === 404 || mr.status === 403) return backWithError(res, ret, 'Du bist nicht auf dem Discord-Server.');
      if (!mr.ok) return backWithError(res, ret, 'Rollen konnten nicht gelesen werden.');
      const m = await mr.json();
      const roles = Array.isArray(m.roles) ? m.roles : [];
      const user = m.user || {};
      const admin = roles.some(r => ADMIN_ROLES.includes(r));
      const lib = admin || roles.some(r => LIB_ROLES.includes(r));
      const healer = admin || roles.some(r => HEALER_ROLES.includes(r));
      console.log('Discord-Rollenprüfung:', {
        user: user.id || 'unbekannt',
        admin,
        lib,
        healer,
        matchedAdminRole: roles.find(r => ADMIN_ROLES.includes(r)) || null
      });
      if (!admin && !lib && !healer) return backWithError(res, ret, 'Dir fehlt die nötige Rolle (Admin, Bibliothek oder Heiler).');
      const token = sign({
        sub: user.id, name: m.nick || user.global_name || user.username || 'Discord',
        admin, lib, healer, exp: Date.now() + SESSION_MS
      });
      return redirect(res, ret + '#auth=' + token);
    } catch (e) {
      return backWithError(res, ret, 'Discord nicht erreichbar.');
    }
  }

  // 3) Token prüfen (Website fragt beim Laden nach)
  if (url.pathname === '/auth/me') {
    const h = req.headers.authorization || '';
    const p = verify(h.replace(/^Bearer\s+/i, ''));
    res.writeHead(p ? 200 : 401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(p ? { ok: true, name: p.name, admin: p.admin, lib: p.lib, healer: !!(p.admin || p.healer), exp: p.exp } : { ok: false }));
  }

  res.writeHead(404); res.end('Not found');
}

/* ===== Mod-Watcher → Discord (MOD_WEBHOOK) =====
   POST /mod-update { content, updates }
   Optional security: X-Mod-Watcher-Secret must match MOD_WATCHER_SECRET.
*/
function modEmbed(body) {
  const updates = Array.isArray(body && body.updates) ? body.updates : [];
  const content = typeof body?.content === 'string' ? body.content.slice(0, 2000) : '';
  if (!content && !updates.length) return null;

  const fields = updates.slice(0, 10).map(u => ({
    name: String(u.title || u.id || 'Unbekannte Mod').slice(0, 256),
    value: [
      u.id ? 'Steam-ID: ' + String(u.id) : '',
      u.newTime ? 'Aktualisiert: <t:' + String(Math.floor(Number(u.newTime))) + ':F>' : ''
    ].filter(Boolean).join('\\n') || 'Mod wurde aktualisiert.',
    inline: false
  }));

  return {
    username: 'Chroniken Mod-Watcher',
    content: content || undefined,
    embeds: fields.length ? [{
      title: '🔧 Conan Exiles Mod-Update',
      color: 0xa855f7,
      fields,
      footer: { text: 'Die Chroniken · Mod-Watcher' },
      timestamp: new Date().toISOString()
    }] : undefined
  };
}

/* ===== Heilerakte → Discord (HEILER_WEBHOOK) =====
   POST /heiler  { action: 'created'|'updated'|'deleted', record: { id, playerName, illness, duration, description }, by } */
function clip(v, n) { const t = String(v == null ? '' : v).trim(); return t ? t.slice(0, n) : '—'; }
function healerEmbed(body) {
  const kinds = {
    created: { title: '🩺 Heilerakte erstellt', color: 0x22c55e },
    updated: { title: '✏️ Heilerakte bearbeitet', color: 0xa855f7 },
    deleted: { title: '🗑️ Heilerakte gelöscht', color: 0x9f1239 }
  };
  const k = kinds[body && body.action];
  const r = body && body.record;
  if (!k || !r || typeof r !== 'object') return null;
  return {
    username: 'Chroniken Heiler',
    embeds: [{
      title: k.title,
      color: k.color,
      fields: [
        { name: 'Ingame-Name', value: clip(r.playerName, 256), inline: true },
        { name: 'Hat', value: clip(r.illness, 256), inline: true },
        { name: 'Heiltage', value: clip(r.duration, 100), inline: true },
        { name: 'Beschreibung', value: clip(r.description, 1000), inline: false }
      ],
      footer: { text: 'Chroniken · Heilerakte ' + clip(r.id, 40) + ' · von ' + clip(body.by, 80) },
      timestamp: new Date().toISOString()
    }]
  };
}

const server = http.createServer(async (req, res) => {
  // CORS – damit die Website aufrufen darf
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');


  if (req.method === 'GET' && url.pathname === '/admin/migration-status') {
    try {
      requireAdmin(req);
      const rows = await supabaseRest('chroniken_data?select=key,updated_at&order=key.asc');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rows }));
    } catch (e) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/migrate-jsonbin') {
    try {
      requireAdmin(req);
      const result = await migrateJsonBinToSupabase();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/weather/set') {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const session = verify(auth);
    if (!session || !session.admin) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: 'Nur Admins dürfen das Wetter setzen.' }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10000) {
        res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'Daten zu groß.' }));
        return;
      }
    }

    try {
      const data = JSON.parse(body || '{}');
      const current = await weather.setCurrentWeather(data.weather || data);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, current }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/weather/moon-send') {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const session = verify(auth);
    if (!session || !session.admin) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: 'Nur Admins dürfen die aktuelle Mondphase senden.' }));
      return;
    }
    try {
      const moonResult = await moon.sendCurrentMoon();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, moon: moonResult }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url.pathname === '/weather' || url.pathname.startsWith('/weather/')) {
    if ((await weather.handle(req, res, url, AUTH_SECRET)) !== false) return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/auth/')) {
    try { await handleAuth(req, res, url); }
    catch (e) { page(res, 500, 'Fehler: ' + e.message); }
    return;
  }

  if (url.pathname === '/mod-update' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'mod-watcher-endpoint' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/mod-update') {
    const suppliedSecret = String(req.headers['x-mod-watcher-secret'] || '');
    if (MOD_WATCHER_SECRET && suppliedSecret !== MOD_WATCHER_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Nicht autorisiert' }));
      return;
    }
    if (!MOD_WEBHOOK) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'MOD_WEBHOOK fehlt' }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 50000) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'zu groß' }));
        return;
      }
    }

    try {
      const payload = modEmbed(JSON.parse(body || '{}'));
      if (!payload) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'ungültige Mod-Daten' }));
        return;
      }
      const r = await fetch(MOD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: r.ok }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/heiler') {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!HEILER_WEBHOOK) return json(500, { ok: false, error: 'HEILER_WEBHOOK fehlt' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 20000) return json(413, { ok: false, error: 'zu groß' }); }
    let payload;
    try { payload = healerEmbed(JSON.parse(body || '{}')); } catch (e) { payload = null; }
    if (!payload) return json(400, { ok: false, error: 'ungültige Daten' });
    try {
      const r = await fetch(HEILER_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return json(r.ok ? 200 : 502, { ok: r.ok });
    } catch (e) {
      return json(500, { ok: false, error: String(e.message) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/charakter') {
    if (!CHAR_WEBHOOK) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'CHAR_WEBHOOK fehlt' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const payload = JSON.parse(body || '{}');
      const r = await fetch(CHAR_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: r.ok }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Listening on', PORT);
  weather.start(PUBLIC_URL);

  // Mod-Watcher direkt im bestehenden Render-Service starten.
  // Dadurch wird kein zweiter Render-Service benötigt.
  try {
    require('./mod-watcher');
    console.log('Mod-Watcher eingebunden (mod-watcher/index.js).');
  } catch (e) {
    console.error('Mod-Watcher konnte nicht gestartet werden:', e.message);
  }
});
