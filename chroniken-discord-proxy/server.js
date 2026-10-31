const http = require('http');
const crypto = require('crypto');
const weather = require('./weather');
const moon = require('./mond');
const { discordFetch, discordOAuthFetch } = require('./discord-rate-limit');

const PORT = process.env.PORT || 3000;
const CHAR_WEBHOOK = process.env.CHAR_WEBHOOK || '';
const HEILER_WEBHOOK = process.env.HEILER_WEBHOOK || '';
const MOD_WEBHOOK = process.env.MOD_WEBHOOK || process.env.DISCORD_MOD_WEBHOOK || '';
const MOD_WATCHER_SECRET = process.env.MOD_WATCHER_SECRET || '';

const db = require('./db');
const MAX_BODY = 10 * 1024 * 1024; // 10 MB pro Speichervorgang (MySQL max_allowed_packet beachten)

function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function requireAdmin(req) {
  const p = verify(bearer(req));
  if (!p || !p.admin) throw new Error('Nur Admins erlaubt.');
  return p;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) { const e = new Error('Daten zu groß.'); e.status = 413; throw e; }
  }
  return body;
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
  console.log('[OAUTH] Request:', req.method, url.pathname);
  // Aufwecken (Render schläft nach Inaktivität) – die Website ruft das im Hintergrund auf
  if (url.pathname === '/auth/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true }));
  }
  // Passwort-Admin: stellt dieselbe signierte Admin-Session aus wie Discord.
  // Die Datenzugriffe verwenden danach unverändert /data und damit MySQL.
  if (url.pathname === '/auth/password' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const configuredPassword = process.env.ADMIN_PASSWORD || 'Chroniken2026';
      if (!body || body.password !== configuredPassword) {
        return sendJson(res, 401, { ok: false, error: 'Falsches Passwort.' });
      }
      const token = sign({
        sub: 'password-admin',
        name: 'Admin',
        admin: true,
        lib: true,
        healer: true,
        exp: Date.now() + SESSION_MS
      });
      console.log('[AUTH] Passwort-Admin erfolgreich angemeldet');
      return sendJson(res, 200, { ok: true, token });
    } catch (e) {
      console.error('[AUTH] Passwort-Login fehlgeschlagen:', e && e.message ? e.message : e);
      return sendJson(res, 400, { ok: false, error: 'Ungültige Anfrage.' });
    }
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
    console.log('[OAUTH] /auth/login aufgerufen');
    const ret = url.searchParams.get('return') || '';
    if (!returnAllowed(ret)) return page(res, 400, 'Rückkehr-Adresse nicht erlaubt. ALLOWED_RETURN_ORIGINS prüfen.');
    return redirect(res, discordAuthorizeUrl(ret));
  }

  // 1b) Discord-Adresse als JSON (Website öffnet sie im Popup, ohne sichtbaren Umweg über Render)
  if (url.pathname === '/auth/start') {
    console.log('[OAUTH] /auth/start aufgerufen');
    const ret = url.searchParams.get('return') || '';
    res.setHeader('Cache-Control', 'no-store');
    if (!returnAllowed(ret)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Rückkehr-Adresse nicht erlaubt. ALLOWED_RETURN_ORIGINS prüfen.' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const authUrl = discordAuthorizeUrl(ret);
    console.log('[OAUTH] Discord Authorization URL erstellt');
    return res.end(JSON.stringify({ ok: true, url: authUrl }));
  }

  // 2) Rückkehr von Discord: Rollen prüfen, Token ausstellen
  if (url.pathname === '/auth/callback') {
    console.log('[OAUTH] /auth/callback erreicht');
    const st = verify(url.searchParams.get('state') || '');
    if (!st) {
      console.error('[OAUTH] State ungültig oder abgelaufen');
      return page(res, 400, 'Anmeldung abgelaufen. Bitte erneut versuchen.');
    }
    console.log('[OAUTH] State erfolgreich geprüft');
    const ret = st.ret;
    if (url.searchParams.get('error')) {
      console.warn('[OAUTH] Discord hat den Login abgebrochen:', url.searchParams.get('error'));
      return backWithError(res, ret, 'Anmeldung abgebrochen.');
    }
    const code = url.searchParams.get('code');
    if (!code) {
      console.error('[OAUTH] Kein Authorization-Code von Discord erhalten');
      return backWithError(res, ret, 'Kein Code von Discord erhalten.');
    }
    console.log('[OAUTH] Authorization-Code erhalten; Token-Anfrage an Discord wird gesendet');
    try {
      const tr = await discordOAuthFetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      });

      const tokenText = await tr.text();
      console.log('[OAUTH] Token-Antwort von Discord:', tr.status);

      if (!tr.ok) {
        let discordError = tokenText;

        try {
          const errorJson = JSON.parse(tokenText);
          discordError =
            errorJson.error_description ||
            errorJson.error ||
            tokenText;
        } catch {
          // Antwort war kein JSON
        }

        console.error('===== DISCORD OAUTH TOKEN FEHLER =====');
        console.error('HTTP-Status:', tr.status);
        console.error('Redirect URI:', redirectUri);
        console.error('Retry-After:', tr.headers.get('retry-after') || 'nicht angegeben');
        console.error('RateLimit-Scope:', tr.headers.get('x-ratelimit-scope') || 'nicht angegeben');
        console.error('RateLimit-Reset-After:', tr.headers.get('x-ratelimit-reset-after') || 'nicht angegeben');
        console.error('Discord Fehler:', discordError);
        console.error('[OAUTH] Token-Austausch fehlgeschlagen');
        console.error('======================================');

        return backWithError(
          res,
          ret,
          'Discord-Anmeldung fehlgeschlagen (Token ' + tr.status + ').'
        );
      }

      let tok;

      try {
        tok = JSON.parse(tokenText);
      } catch (e) {
        console.error('===== DISCORD TOKEN ANTWORT FEHLER =====');
        console.error('Antwort von Discord ist kein gültiges JSON.');
        console.error('HTTP-Status:', tr.status);
        console.error('========================================');

        return backWithError(
          res,
          ret,
          'Ungültige Antwort von Discord.'
        );
      }

      console.log('[OAUTH] Token-Austausch erfolgreich');

      if (!tok.access_token) {
        console.error('===== DISCORD TOKEN FEHLT =====');
        console.error('Discord hat keinen access_token zurückgegeben.');
        console.error('================================');

        return backWithError(
          res,
          ret,
          'Discord hat keinen Zugriffstoken geliefert.'
        );
      }
      console.log('[OAUTH] Prüfe Discord-Servermitgliedschaft und Rollen');
      const mr = await discordOAuthFetch('https://discord.com/api/users/@me/guilds/' + GUILD_ID + '/member', {
        headers: { Authorization: 'Bearer ' + tok.access_token }
      });
      console.log('[OAUTH] Rollen-API Antwort:', mr.status);
      if (mr.status === 404 || mr.status === 403) {
        console.warn('[OAUTH] Benutzer ist nicht auf dem Discord-Server oder Zugriff verweigert');
        return backWithError(res, ret, 'Du bist nicht auf dem Discord-Server.');
      }
      if (!mr.ok) {
        console.error('[OAUTH] Rollen konnten nicht gelesen werden. HTTP:', mr.status);
        return backWithError(res, ret, 'Rollen konnten nicht gelesen werden.');
      }
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
      if (!admin && !lib && !healer) {
        console.warn('[OAUTH] Keine passende Chroniken-Rolle gefunden');
        return backWithError(res, ret, 'Dir fehlt die nötige Rolle (Admin, Bibliothek oder Heiler).');
      }
      const token = sign({
        sub: user.id, name: m.nick || user.global_name || user.username || 'Discord',
        admin, lib, healer, exp: Date.now() + SESSION_MS
      });
      console.log('[OAUTH] Login erfolgreich; Session wird an Website zurückgegeben');
      return redirect(res, ret + '#auth=' + token);
    } catch (e) {
      if (e && e.code === 'DISCORD_RATE_LIMITED') {
        console.warn('[Discord OAuth] Rate-Limit aktiv. Login wird sofort beendet statt zu warten.');
        return backWithError(
          res,
          ret,
          'Discord ist gerade ausgelastet. Bitte in 30–60 Sekunden erneut anmelden.'
        );
      }
      console.error('[OAUTH] Unerwarteter Fehler:', e && e.message ? e.message : e);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');


  // ===== Chroniken-Daten (MySQL) =====
  // GET  /data         → alle Schlüssel { ok, data: { key: value } }   (öffentlich)
  // GET  /data/:key    → ein Schlüssel { ok, key, value }              (öffentlich)
  // PUT  /data/:key    → { value } speichern, Rechte je Schlüssel (db.js)
  // PUT  /data         → { data: { key: value, ... } } mehrere in einer Transaktion
  if (url.pathname === '/data' || url.pathname.startsWith('/data/')) {
    try {
      const rest = url.pathname.slice('/data'.length).replace(/^\//, '');
      const single = rest ? db.normalizeKey(decodeURIComponent(rest)) : '';
      if (single && !db.KEYS[single]) return sendJson(res, 404, { ok: false, error: 'Unbekannter Schlüssel: ' + single });

      if (req.method === 'GET') {
        if (single) return sendJson(res, 200, { ok: true, key: single, value: await db.getOne(single) });
        return sendJson(res, 200, { ok: true, data: await db.getAll() });
      }

      if (req.method === 'PUT') {
        const session = verify(bearer(req));
        const parsed = JSON.parse((await readBody(req)) || '{}');
        const input = single
          ? { [single]: parsed.value }
          : (parsed && typeof parsed.data === 'object' && parsed.data ? parsed.data : {});

        const entries = [];
        for (const [rawKey, value] of Object.entries(input)) {
          const key = db.normalizeKey(rawKey);
          if (!db.KEYS[key]) return sendJson(res, 400, { ok: false, error: 'Unbekannter Schlüssel: ' + rawKey });
          if (!db.validValue(key, value)) {
            return sendJson(res, 400, { ok: false, error: 'Ungültiger Wert für ' + key + ' (erwartet: ' + db.KEYS[key].type + ').' });
          }
          if (!db.canWrite(key, session)) {
            return sendJson(res, session ? 403 : 401, {
              ok: false,
              error: session ? 'Dir fehlt die Berechtigung für „' + key + '“.' : 'Anmeldung erforderlich für „' + key + '“.'
            });
          }
          entries.push({ key, value });
        }
        if (!entries.length) return sendJson(res, 400, { ok: false, error: 'Keine Daten zum Speichern erhalten.' });

        await db.setMany(entries);
        return sendJson(res, 200, { ok: true, keys: entries.map(e => e.key) });
      }

      return sendJson(res, 405, { ok: false, error: 'Methode nicht erlaubt.' });
    } catch (e) {
      console.error('[/data]', e.message);
      const status = e.status || (e instanceof SyntaxError ? 400 : 500);
      return sendJson(res, status, { ok: false, error: status === 500 ? 'Datenbankfehler: ' + e.message : e.message });
    }
  }

  // Admin: Zustand der Datenbank (Schlüssel, Einträge, letzte Änderung)
  if (req.method === 'GET' && url.pathname === '/admin/db-status') {
    try {
      requireAdmin(req);
      return sendJson(res, 200, { ok: true, rows: await db.status() });
    } catch (e) {
      return sendJson(res, /Admin/.test(e.message) ? 403 : 500, { ok: false, error: e.message });
    }
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
      const r = await discordFetch(MOD_WEBHOOK, {
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
      const r = await discordFetch(HEILER_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
      const r = await discordFetch(CHAR_WEBHOOK, {
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
  if (db.configured()) {
    db.ensureSchema().catch(e => console.error('[DB] Einrichtung fehlgeschlagen:', e.message));
  } else {
    console.warn('[DB] MYSQL_URL bzw. MYSQL_HOST/MYSQL_DATABASE nicht gesetzt – /data funktioniert erst nach der Einrichtung.');
  }
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
