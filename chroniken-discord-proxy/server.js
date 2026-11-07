const http = require('http');
const crypto = require('crypto');
const weather = require('./weather');
const moon = require('./mond');
const { discordFetch, discordOAuthFetch, discordOAuthCooldownStatus } = require('./discord-rate-limit');

const PORT = process.env.PORT || 3000;
const CHAR_WEBHOOK = process.env.CHAR_WEBHOOK || '';
const HEILER_WEBHOOK = process.env.HEILER_WEBHOOK || '';
const MOD_WEBHOOK = process.env.MOD_WEBHOOK || process.env.DISCORD_MOD_WEBHOOK || '';
const MOD_WATCHER_SECRET = process.env.MOD_WATCHER_SECRET || '';\nconst BOT_API_URL = (process.env.BOT_API_URL || 'http://78.154.103.23:14071').replace(/\\/$/, '');\nconst BOT_API_SECRET = process.env.BOT_API_SECRET || '';

const db = require('./db');
const adminApi = require('./admin-api');
const MAX_BODY = 10 * 1024 * 1024; // 10 MB pro Speichervorgang (MySQL max_allowed_packet beachten)

function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function parseCookies(req) {
  const out = Object.create(null);
  const raw = String(req.headers.cookie || '');
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  });
  return out;
}

const SESSION_COOKIE = 'chroniken_session';

function sessionFromRequest(req) {
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE] || '';
  return verify(cookieToken) || verify(bearer(req));
}

function setSessionCookie(res, token) {
  const maxAge = Math.max(60, Math.floor(SESSION_MS / 1000));
  res.setHeader('Set-Cookie',
    SESSION_COOKIE + '=' + encodeURIComponent(token) +
    '; Max-Age=' + maxAge +
    '; Path=/' +
    '; HttpOnly' +
    '; Secure' +
    '; SameSite=None'
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    SESSION_COOKIE + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None'
  );
}

function requireAdmin(req) {
  const p = sessionFromRequest(req);
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
const ALLOWED_ORIGINS = (process.env.ALLOWED_RETURN_ORIGINS ||
  'https://xxleynaxx.github.io,http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const SESSION_MS = (Number(process.env.SESSION_HOURS) || 12) * 3600 * 1000;

const oauthCallbackClaims = new Map();
const OAUTH_CALLBACK_CLAIM_MS = 10 * 60 * 1000;

function oauthLog(requestId, phase, event, startedAt, metadata = {}) {
  console.log('[OAUTH]', JSON.stringify({
    requestId,
    phase,
    event,
    elapsedMs: startedAt == null ? undefined : Math.max(0, Date.now() - startedAt),
    ...metadata
  }));
}

function sanitizeOAuthText(value, sensitiveValues = []) {
  let text = String(value == null ? '' : value).slice(0, 4000);
  for (const secret of sensitiveValues) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.split(secret).join('[redacted]');
    }
  }
  return text
    .replace(/https?:\/\/\S+/gi, '[URL redacted]')
    .replace(/\b(access_token|refresh_token|client_secret|authorization_code|code|state|session_token)\b\s*[:=]\s*[^\s,;"'}]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s,;"'}]+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .slice(0, 1000);
}

function sanitizedDiscordError(bodyText, sensitiveValues = []) {
  let details;
  try {
    const body = JSON.parse(String(bodyText || '').slice(0, 16000));
    details = {};
    for (const key of ['error', 'error_description', 'message', 'code']) {
      if (typeof body[key] === 'string' || typeof body[key] === 'number') {
        details[key] = sanitizeOAuthText(body[key], sensitiveValues);
      }
    }
  } catch {
    details = { body: sanitizeOAuthText(bodyText, sensitiveValues) };
  }
  return details;
}

function discordRateLimitMetadata(response) {
  const headers = response.headers;
  return {
    status: response.status,
    retryAfter: headers.get('retry-after'),
    rateLimitScope: headers.get('x-ratelimit-scope'),
    rateLimitResetAfter: headers.get('x-ratelimit-reset-after'),
    rateLimitReset: headers.get('x-ratelimit-reset'),
    rateLimitBucket: headers.get('x-ratelimit-bucket'),
    rateLimitLimit: headers.get('x-ratelimit-limit'),
    rateLimitRemaining: headers.get('x-ratelimit-remaining'),
    rateLimitGlobal: headers.get('x-ratelimit-global')
  };
}

function formatOAuthWait(ms) {
  const totalSeconds = Math.max(1, Math.ceil(Number(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes) return minutes + ' Min. ' + seconds + ' Sek.';
  return seconds + ' Sek.';
}

function oauthCooldownMessage(ms) {
  return 'Discord begrenzt gerade Anmeldungen. Bitte warte noch ' + formatOAuthWait(ms) + ' und versuche es dann erneut.';
}

function claimOAuthCallback(code) {
  const now = Date.now();
  for (const [key, expiresAt] of oauthCallbackClaims) {
    if (expiresAt <= now) oauthCallbackClaims.delete(key);
  }
  const key = crypto.createHash('sha256').update(code).digest('hex');
  if (oauthCallbackClaims.has(key)) return false;
  if (oauthCallbackClaims.size >= 10000) {
    oauthCallbackClaims.delete(oauthCallbackClaims.keys().next().value);
  }
  oauthCallbackClaims.set(key, now + OAUTH_CALLBACK_CLAIM_MS);
  return true;
}

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
  if (url.pathname === '/auth/logout') {
    clearSessionCookie(res);
    return redirect(res, PUBLIC_URL + '/auth/ping');
  }

  if (url.pathname === '/auth/login') {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const ret = url.searchParams.get('return') || '';
    if (!returnAllowed(ret)) {
      oauthLog(requestId, 'login', 'rejected_return_origin', startedAt, { status: 400 });
      return page(res, 400, 'Rückkehr-Adresse nicht erlaubt. ALLOWED_RETURN_ORIGINS prüfen.');
    }
    const cooldown = discordOAuthCooldownStatus();
    if (cooldown.retryAfterMs > 0) {
      oauthLog(requestId, 'login', 'rate_limit_cooldown_active', startedAt, {
        status: 429,
        ...cooldown
      });
      res.setHeader('Retry-After', String(Math.ceil(cooldown.retryAfterMs / 1000)));
      return page(res, 429, oauthCooldownMessage(cooldown.retryAfterMs));
    }
    oauthLog(requestId, 'login', 'started', startedAt, { status: 302 });
    return redirect(res, discordAuthorizeUrl(ret));
  }

  // 1b) Discord-Adresse als JSON (Website öffnet sie im Popup, ohne sichtbaren Umweg über Render)
  if (url.pathname === '/auth/start') {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const ret = url.searchParams.get('return') || '';
    res.setHeader('Cache-Control', 'no-store');
    if (!returnAllowed(ret)) {
      oauthLog(requestId, 'start', 'rejected_return_origin', startedAt, { status: 400 });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Rückkehr-Adresse nicht erlaubt. ALLOWED_RETURN_ORIGINS prüfen.' }));
    }
    const cooldown = discordOAuthCooldownStatus();
    if (cooldown.retryAfterMs > 0) {
      oauthLog(requestId, 'start', 'rate_limit_cooldown_active', startedAt, {
        status: 429,
        ...cooldown
      });
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(cooldown.retryAfterMs / 1000))
      });
      return res.end(JSON.stringify({
        ok: false,
        error: oauthCooldownMessage(cooldown.retryAfterMs),
        retryAfterMs: cooldown.retryAfterMs,
        resumeAt: cooldown.resumeAt
      }));
    }
    const authUrl = discordAuthorizeUrl(ret);
    oauthLog(requestId, 'start', 'authorization_url_created', startedAt, { status: 200 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, url: authUrl }));
  }

  // 2) Rückkehr von Discord: Rollen prüfen, Token ausstellen
  if (url.pathname === '/auth/callback') {
    const requestId = crypto.randomUUID();
    const callbackStartedAt = Date.now();
    oauthLog(requestId, 'callback', 'received', callbackStartedAt);
    const stateStartedAt = Date.now();
    const st = verify(url.searchParams.get('state') || '');
    if (!st) {
      oauthLog(requestId, 'state_validation', 'rejected', stateStartedAt, { status: 400, reason: 'invalid_or_expired' });
      return page(res, 400, 'Anmeldung abgelaufen. Bitte erneut versuchen.');
    }
    oauthLog(requestId, 'state_validation', 'accepted', stateStartedAt, { status: 200 });
    const ret = st.ret;
    if (url.searchParams.get('error')) {
      const providerError = url.searchParams.get('error');
      const safeProviderError = /^[a-z0-9_-]{1,60}$/i.test(providerError) ? providerError : 'unrecognized';
      oauthLog(requestId, 'callback', 'provider_rejected', callbackStartedAt, { status: 400, providerError: safeProviderError });
      return backWithError(res, ret, 'Anmeldung abgebrochen.');
    }
    const code = url.searchParams.get('code');
    if (!code) {
      oauthLog(requestId, 'callback', 'missing_code', callbackStartedAt, { status: 400 });
      return backWithError(res, ret, 'Kein Code von Discord erhalten.');
    }
    if (!claimOAuthCallback(code)) {
      oauthLog(requestId, 'callback', 'duplicate_code_rejected', callbackStartedAt, {
        status: ret && returnAllowed(ret) ? 302 : 400
      });
      return backWithError(res, ret, 'Dieser Anmeldeversuch wurde bereits verarbeitet. Bitte starte die Anmeldung erneut.');
    }
    let activeOAuthPhase = 'token_exchange';
    let activePhaseStartedAt = Date.now();
    try {
      const tokenStartedAt = activePhaseStartedAt;
      oauthLog(requestId, 'token_exchange', 'started', tokenStartedAt);
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
      const tokenResponseMeta = discordRateLimitMetadata(tr);

      if (!tr.ok) {
        const cooldown = tr.status === 429 ? discordOAuthCooldownStatus() : null;
        oauthLog(requestId, 'token_exchange', 'failed', tokenStartedAt, {
          ...tokenResponseMeta,
          ...(cooldown && { retryAfterMs: cooldown.retryAfterMs, resumeAt: cooldown.resumeAt }),
          discordError: sanitizedDiscordError(tokenText, [CLIENT_SECRET, code])
        });

        return backWithError(
          res,
          ret,
          tr.status === 429 && cooldown.retryAfterMs > 0
            ? oauthCooldownMessage(cooldown.retryAfterMs)
            : 'Discord-Anmeldung fehlgeschlagen (Token ' + tr.status + ').'
        );
      }

      let tok;

      try {
        tok = JSON.parse(tokenText);
      } catch (e) {
        oauthLog(requestId, 'token_exchange', 'invalid_json', tokenStartedAt, tokenResponseMeta);

        return backWithError(
          res,
          ret,
          'Ungültige Antwort von Discord.'
        );
      }

      oauthLog(requestId, 'token_exchange', 'succeeded', tokenStartedAt, tokenResponseMeta);

      if (!tok.access_token) {
        oauthLog(requestId, 'token_exchange', 'missing_access_token', tokenStartedAt, tokenResponseMeta);

        return backWithError(
          res,
          ret,
          'Discord hat keinen Zugriffstoken geliefert.'
        );
      }
      const memberStartedAt = Date.now();
      activeOAuthPhase = 'member_role_lookup';
      activePhaseStartedAt = memberStartedAt;
      oauthLog(requestId, 'member_role_lookup', 'started', memberStartedAt);
      const mr = await discordOAuthFetch('https://discord.com/api/users/@me/guilds/' + GUILD_ID + '/member', {
        headers: { Authorization: 'Bearer ' + tok.access_token }
      });
      const memberResponseMeta = discordRateLimitMetadata(mr);
      if (!mr.ok) {
        const errorBody = await mr.text().catch(() => '');
        const cooldown = mr.status === 429 ? discordOAuthCooldownStatus() : null;
        const errorMetadata = {
          ...memberResponseMeta,
          ...(cooldown && { retryAfterMs: cooldown.retryAfterMs, resumeAt: cooldown.resumeAt }),
          discordError: sanitizedDiscordError(errorBody, [CLIENT_SECRET, code, tok.access_token, tok.refresh_token])
        };
        if (mr.status === 404 || mr.status === 403) {
          oauthLog(requestId, 'member_role_lookup', 'not_member_or_forbidden', memberStartedAt, errorMetadata);
          return backWithError(res, ret, 'Du bist nicht auf dem Discord-Server.');
        }
        oauthLog(requestId, 'member_role_lookup', 'failed', memberStartedAt, errorMetadata);
        return backWithError(res, ret, mr.status === 429 && cooldown.retryAfterMs > 0
          ? oauthCooldownMessage(cooldown.retryAfterMs)
          : 'Rollen konnten nicht gelesen werden.');
      }
      let m;
      try {
        m = await mr.json();
      } catch {
        oauthLog(requestId, 'member_role_lookup', 'invalid_json', memberStartedAt, memberResponseMeta);
        return backWithError(res, ret, 'Rollen konnten nicht gelesen werden.');
      }
      oauthLog(requestId, 'member_role_lookup', 'succeeded', memberStartedAt, memberResponseMeta);
      const roles = Array.isArray(m.roles) ? m.roles : [];
      const user = m.user || {};
      const admin = roles.some(r => ADMIN_ROLES.includes(r));
      const lib = admin || roles.some(r => LIB_ROLES.includes(r));
      const healer = admin || roles.some(r => HEALER_ROLES.includes(r));
      oauthLog(requestId, 'role_validation', 'completed', memberStartedAt, { admin, lib, healer });
      if (!admin && !lib && !healer) {
        oauthLog(requestId, 'role_validation', 'no_required_role', memberStartedAt);
        return backWithError(res, ret, 'Dir fehlt die nötige Rolle (Admin, Bibliothek oder Heiler).');
      }
      const token = sign({
        sub: user.id,
        name: m.nick || user.global_name || user.username || 'Discord',
        admin, lib, healer,
        exp: Date.now() + SESSION_MS
      });
      setSessionCookie(res, token);
      oauthLog(requestId, 'callback', 'login_succeeded', callbackStartedAt, { status: 302, admin, lib, healer });
      const separator = ret.includes('?') ? '&' : '?';
      return redirect(res, ret + separator + 'auth_done=1');
    } catch (e) {
      if (e && e.code === 'DISCORD_RATE_LIMITED') {
        oauthLog(requestId, activeOAuthPhase, 'blocked_by_rate_limit', activePhaseStartedAt, {
          status: null,
          retryAfterMs: Math.max(0, Number(e.retryAfterMs) || 0)
        });
        return backWithError(
          res,
          ret,
          oauthCooldownMessage(e.retryAfterMs)
        );
      }
      oauthLog(requestId, activeOAuthPhase, 'request_error', activePhaseStartedAt, {
        status: null,
        error: sanitizeOAuthText(e && e.message ? e.message : 'unknown', [CLIENT_SECRET, code])
      });
      oauthLog(requestId, 'callback', 'failed', callbackStartedAt, { status: 502 });
      return backWithError(res, ret, 'Discord nicht erreichbar.');
    }
  }

  // 3) Token prüfen (Website fragt beim Laden nach)
  if (url.pathname === '/auth/me') {
    const p = sessionFromRequest(req);
    res.writeHead(p ? 200 : 401, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(
      p
        ? { ok: true, name: p.name, admin: p.admin, lib: p.lib, healer: !!(p.admin || p.healer), exp: p.exp }
        : { ok: false }
    ));
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
  const requestOrigin = String(req.headers.origin || '').replace(/\/$/, '');
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');


  // ===== Internes Admin-System (MySQL + Discord) =====
  if (url.pathname.startsWith('/admin/')) {
    const handled = await adminApi.handle(req, res, url, sessionFromRequest(req), process.env.ADMIN_WEBHOOK || process.env.ADMIN_TASK_WEBHOOK || '');
    if (handled !== false) return;
  }


  // ===== Discord-Rollen aus der Charakterverwaltung =====
  // Die Website spricht nur mit diesem Server. Das Bot-Secret bleibt auf Render
  // und wird niemals an den Browser ausgeliefert.
  if (req.method === 'POST' && url.pathname === '/roles/sync') {
    try {
      const session = sessionFromRequest(req);
      if (!session || !session.admin) {
        return sendJson(res, 403, { ok: false, error: 'Nur Admins dürfen Discord-Rollen synchronisieren.' });
      }
      if (!BOT_API_SECRET) {
        return sendJson(res, 500, { ok: false, error: 'BOT_API_SECRET fehlt auf dem Server.' });
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const username = String(body.username || '').trim();
      if (!username) return sendJson(res, 400, { ok: false, error: 'Discord-Name fehlt.' });

      const upstream = await fetch(BOT_API_URL + '/api/roles/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-api-key': BOT_API_SECRET
        },
        body: JSON.stringify({
          username,
          heiler: body.heiler === true,
          bibliothek: body.bibliothek === true
        })
      });
      const text = await upstream.text();
      let data = {};
      try { data = JSON.parse(text || '{}'); } catch {}
      if (!upstream.ok) {
        return sendJson(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
          ok: false,
          error: data.error || 'Discord-Rollen konnten nicht synchronisiert werden.',
          code: data.code || undefined
        });
      }
      return sendJson(res, 200, data && typeof data === 'object' ? data : { ok: true });
    } catch (e) {
      console.error('[roles/sync]', e.message);
      return sendJson(res, 502, { ok: false, error: 'Bot-API nicht erreichbar: ' + e.message });
    }
  }

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
        const session = sessionFromRequest(req);
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
    const session = sessionFromRequest(req);
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

  if (req.method === 'POST' && url.pathname === '/character/check') {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 5000) return sendJson(res, 413, { ok: false, error: 'Daten zu groß.' }); }
    try {
      const data = JSON.parse(body || '{}');
      const steamId = String(data.steamId || '').trim();
      if (!steamId) return sendJson(res, 200, { ok: true, blocked: false });
      const hit = await db.isSteamBlacklisted(steamId);
      return sendJson(res, 200, { ok: true, blocked: !!hit, entry: hit ? { player_name: hit.player_name || '', reason: hit.reason || '' } : null });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'Blacklist-Prüfung fehlgeschlagen.' });
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

