/**
 * Chroniken Wetter → Discord (läuft im Render-Proxy)
 *
 * Zustand kommt aus dem Haupt-Bin (Schlüssel "weather"), den das Wetter-Menü
 * auf wetter.html (nur Admins) schreibt: Wetterlagen, Timer, gewähltes/übersprungenes
 * Wetter, Discord-Titel/Text. Ohne gespeicherten Zustand gilt weather-config.js.
 * Gleiche Formel wie wetter.js → Webseite und Discord zeigen dasselbe Wetter.
 *
 * Render → Environment:
 *   DISCORD_WEATHER_WEBHOOK  Webhook-URL (Pflicht, sonst wird nichts gepostet)
 * Optional:
 *   JSONBIN_BIN_ID / JSONBIN_MASTER_KEY  (Standard: Haupt-Bin + Key aus jsonbin-storage.js)
 *   WEATHER_KEEPALIVE=0   Selbst-Ping abschalten (nur bei bezahltem Render-Plan sinnvoll)
 *   WEATHER_WINDOW_MIN    Minuten nach einem Wechsel, in denen noch gemeldet wird (Standard 10)
 *
 * Routen:
 *   GET  /weather              aktuelles Wetter + letzte Meldung
 *   GET  /weather/state        gespeicherter Zustand (für die Webseite)
 *   POST /weather/reload       Zustand neu aus JSONBin laden (Wetter-Menü ruft das nach dem Speichern)
 *   GET  /weather/send?key=AUTH_SECRET   sofort melden
 */
const path = require('path');

const WEBHOOK = process.env.DISCORD_WEATHER_WEBHOOK || '';
const BIN_ID = process.env.JSONBIN_BIN_ID || '6ae177efffd5d1605391bc4e';
const JSONBIN_API = (process.env.JSONBIN_API || 'https://api.jsonbin.io/v3/b/').replace(/\/?$/, '/');
const MASTER_KEY = process.env.JSONBIN_MASTER_KEY || '$2a$10$UtTY0igLD.IvUKF5WDV89uC7/zf7h2HP3R3jXC/mghWJDo20hRpqO';
const WINDOW_MS = (Number(process.env.WEATHER_WINDOW_MIN) || 10) * 60 * 1000;
const TZ = 'Europe/Berlin';
const MOON_START = new Date('2026-10-17T00:00:00').getTime();
const MOON_PHASES = [
  { name: 'Neumond', icon: '🌑', description: 'Zeit der Stille und des Neubeginns.' },
  { name: 'Zunehmende Sichel', icon: '🌒', description: 'Das Licht kehrt langsam zurück.' },
  { name: 'Halbmond', icon: '🌓', description: 'Licht und Dunkelheit halten sich die Waage.' },
  { name: 'Zunehmender Mond', icon: '🌔', description: 'Die Nächte werden heller.' },
  { name: 'Vollmond', icon: '🌕', description: 'Der Mond steht vollständig am Himmel.' },
  { name: 'Blutmond', icon: '🔴', description: 'Ein seltener roter Vollmond. Die Nacht wirkt unheilvoll und magisch.' },
  { name: 'Abnehmender Mond', icon: '🌖', description: 'Das Mondlicht nimmt langsam ab.' },
  { name: 'Letzter Halbmond', icon: '🌗', description: 'Die Schatten gewinnen wieder Raum.' },
  { name: 'Abnehmende Sichel', icon: '🌘', description: 'Nur noch ein schmaler Lichtbogen bleibt.' }
];
const DEFAULT_TITLE = '🌦️ Wetter in Chroniken';
const DEFAULT_TEXT = '%wetter_icon% %wetter% ist jetzt bei Chroniken.\n\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%';

let shared = null;          // normalisierter Zustand
let source = 'file';        // 'jsonbin' | 'file'
let loadedAt = 0;
let lastSentKey = null;
let lastMoonSentKey = null;
let lastResult = null;
let lastMoonResult = null;
let reloadChain = Promise.resolve();

/* ---------- Config / Normalisieren (wie wetter.js) ---------- */
function cleanWeather(w) {
  w = w || {};
  return {
    name: String(w.name || '').trim() || 'Unbenannt',
    icon: String(w.icon || '').trim() || '🌤️',
    description: String(w.description || '').trim(),
    weight: Math.max(0, Number(w.weight) || 0)
  };
}

function fileConfig() {
  let raw = null;
  for (const p of [path.join(__dirname, '..', 'weather-config.js'), path.join(__dirname, 'weather-config.js')]) {
    try { delete require.cache[require.resolve(p)]; raw = require(p); break; } catch (e) {}
  }
  const list = raw && Array.isArray(raw.weather) && raw.weather.length ? raw.weather : [{ name: 'Klarer Himmel', icon: '☀️', description: '', weight: 1 }];
  return { intervalMinutes: Math.max(1, Number(raw && raw.intervalHours) || 6) * 60, weather: list.map(cleanWeather) };
}

function normalize(raw) {
  const base = fileConfig();
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    intervalMinutes: Math.max(1, Math.round(Number(raw.intervalMinutes) || base.intervalMinutes)),
    weather: Array.isArray(raw.weather) && raw.weather.length ? raw.weather.map(cleanWeather) : base.weather,
    anchor: Number(raw.anchor) || 0,
    seed: Math.max(0, Math.floor(Number(raw.seed) || 0)),
    forced: raw.forced && raw.forced.name ? cleanWeather(raw.forced) : null,
    forcedSlot: Math.max(0, Math.floor(Number(raw.forcedSlot) || 0)),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : DEFAULT_TITLE,
    text: typeof raw.text === 'string' && raw.text.trim() ? raw.text : DEFAULT_TEXT,
    updatedAt: Number(raw.updatedAt) || 0
  };
}

function randomIndex(seed, length) {
  if (!length || length < 1) return 0;
  let x = (seed * 1103515245 + 12345) >>> 0;
  x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
  return x % length;
}
function pickWeighted(seed, list) {
  const total = list.reduce((s, w) => s + w.weight, 0);
  if (total <= 0) return list[randomIndex(seed, list.length)] || list[0];
  let r = randomIndex(seed, total);
  for (const w of list) { r -= w.weight; if (r < 0) return w; }
  return list[list.length - 1];
}

function computeMoon(now = Date.now()) {
  // Kalenderrechnung: Jede Mondphase dauert 15 reale Tage.
  // 9 Phasen ergeben damit einen vollständigen RP-Mondzyklus von 135 Tagen.
  const PHASE_DAYS = 15;
  const realDays = Math.max(0, Math.floor((now - MOON_START) / 86400000));
  const phaseIndex = Math.floor(realDays / PHASE_DAYS);
  const totalDays = realDays;
  const slot = phaseIndex % MOON_PHASES.length;
  const phase = MOON_PHASES[slot] || MOON_PHASES[0];
  return {
    key: 'moon:' + phaseIndex,
    slot,
    name: phase.name,
    icon: phase.icon,
    description: phase.description,
    totalDays,
    changedAt: new Date(MOON_START + phaseIndex * PHASE_DAYS * 86400000).toISOString(),
    nextChangeAt: new Date(MOON_START + (phaseIndex + 1) * PHASE_DAYS * 86400000).toISOString()
  };
}

function compute(st, now = Date.now()) {
  const ms = st.intervalMinutes * 60000;
  const k = Math.max(0, Math.floor((now - st.anchor) / ms));
  const forced = !!(st.forced && k === st.forcedSlot);
  const w = forced ? st.forced : pickWeighted(st.seed + k, st.weather);
  return {
    key: st.anchor + ':' + k, slot: k,
    name: w.name, icon: w.icon, description: w.description, forced,
    intervalMinutes: st.intervalMinutes,
    msIntoSlot: now - (st.anchor + k * ms),
    msNext: st.anchor + (k + 1) * ms - now,
    changedAt: new Date(st.anchor + k * ms).toISOString(),
    nextChangeAt: new Date(st.anchor + (k + 1) * ms).toISOString()
  };
}

/* ---------- JSONBin ---------- */
async function loadState() {
  try {
    const r = await fetch(JSONBIN_API + BIN_ID + '/latest', {
      headers: { 'X-Master-Key': MASTER_KEY, 'X-Bin-Meta': 'false' }
    });
    if (!r.ok) throw new Error('JSONBin ' + r.status);
    const data = await r.json();
    const rec = data && data.record ? data.record : data;
    const w = rec && rec.weather;
    if (w && typeof w === 'object' && !Array.isArray(w)) { shared = normalize(w); source = 'jsonbin'; }
    else { shared = normalize(null); source = 'file'; }
    loadedAt = Date.now();
  } catch (e) {
    console.error('Wetter: Zustand nicht ladbar (' + e.message + ')' + (shared ? ', behalte letzten.' : ', nehme weather-config.js.'));
    if (!shared) { shared = normalize(null); source = 'file'; }
  }
  return shared;
}

/* ---------- Discord ---------- */
function format(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  const hms = [Math.floor((t % 86400) / 3600), Math.floor((t % 3600) / 60), t % 60].map(n => String(n).padStart(2, '0')).join(':');
  return d ? d + 'T ' + hms : hms;
}
function intervalText(min) {
  if (min % 1440 === 0) return (min / 1440) + (min === 1440 ? ' Tag' : ' Tage');
  if (min % 60 === 0) return (min / 60) + (min === 60 ? ' Stunde' : ' Stunden');
  return min + (min === 1 ? ' Minute' : ' Minuten');
}
function replaceVars(text, w) {
  const now = new Date();
  const vars = {
    wetter: w.name, wetter_icon: w.icon, wetter_beschreibung: w.description,
    naechster_wetterwechsel: format(w.msNext),
    datum: now.toLocaleDateString('de-DE', { timeZone: TZ }),
    zeit: now.toLocaleTimeString('de-DE', { timeZone: TZ })
  };
  return String(text || '').replace(/%([a-zA-Z0-9_]+)%/g, (_, k) => vars[k] !== undefined ? vars[k] : '%' + k + '%');
}

async function discordWebhookUrl() {
  if (!WEBHOOK) throw new Error('DISCORD_WEATHER_WEBHOOK fehlt');
  try {
    const u = new URL(WEBHOOK);
    u.searchParams.set('wait', 'true');
    return u.toString();
  } catch {
    throw new Error('DISCORD_WEATHER_WEBHOOK ist keine gültige Discord-Webhook-URL');
  }
}

async function send(st, w) {
  const webhookUrl = await discordWebhookUrl();
  const r = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Chroniken Wetter',
      embeds: [{
        title: replaceVars(st.title, w).slice(0, 256),
        description: replaceVars(st.text, w).slice(0, 4000),
        color: 0x7c3aed,
        footer: { text: 'Chroniken · Wetter · Wechsel alle ' + intervalText(st.intervalMinutes) },
        timestamp: new Date().toISOString()
      }]
    })
  });
  if (!r.ok) throw new Error('Discord ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

async function sendMoon(moon) {
  const webhookUrl = await discordWebhookUrl();
  const now = new Date();
  const r = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Chroniken Wetter',
      embeds: [{
        title: moon.icon + ' Mondphase gewechselt: ' + moon.name,
        description: moon.description + '\\n\\nDer Mondkalender der Chroniken hat eine neue Phase erreicht.',
        color: moon.name === 'Blutmond' ? 0xef4444 : 0x7c3aed,
        fields: [
          { name: 'Neue Mondphase', value: moon.icon + ' **' + moon.name + '**', inline: true },
          { name: 'Nächster Wechsel', value: '<t:' + Math.floor(new Date(moon.nextChangeAt).getTime() / 1000) + ':F>', inline: true }
        ],
        footer: { text: 'Chroniken · Mondkalender · gleicher Wetter-Webhook' },
        timestamp: now.toISOString()
      }]
    })
  });
  if (!r.ok) throw new Error('Discord ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

async function tickMoon() {
  if (!WEBHOOK) return false;
  const moon = computeMoon();
  if (lastMoonSentKey === null) {
    lastMoonSentKey = moon.key;
    return false;
  }
  if (lastMoonSentKey === moon.key) return false;
  try {
    await sendMoon(moon);
    lastMoonSentKey = moon.key;
    lastMoonResult = { ok: true, at: new Date().toISOString(), name: moon.name, key: moon.key };
    console.log('Mondphase gemeldet:', moon.icon, moon.name, '(' + moon.key + ')');
    return true;
  } catch (e) {
    lastMoonResult = { ok: false, at: new Date().toISOString(), error: e.message };
    console.error('Mondphase-Fehler:', e.message);
    return false;
  }
}

async function sendCurrentMoon() {
  if (!WEBHOOK) throw new Error('DISCORD_WEATHER_WEBHOOK fehlt');
  const moon = computeMoon();
  await sendMoon(moon);
  lastMoonSentKey = moon.key;
  lastMoonResult = {
    ok: true,
    at: new Date().toISOString(),
    name: moon.name,
    key: moon.key,
    manual: true
  };
  console.log('Mondphase manuell gemeldet:', moon.icon, moon.name, '(' + moon.key + ')');
  return moon;
}

async function tick() {
  if (!shared) await loadState();
  await tickMoon();
  const st = shared;
  const w = compute(st);
  if (!WEBHOOK || lastSentKey === w.key) return false;
  if (w.msIntoSlot > Math.min(WINDOW_MS, st.intervalMinutes * 60000)) return false;
  try {
    await send(st, w);
    lastSentKey = w.key;
    lastResult = { ok: true, at: new Date().toISOString(), name: w.name };
    console.log('Wetter gemeldet:', w.icon, w.name, '(' + w.key + ')');
    return true;
  } catch (e) {
    lastResult = { ok: false, at: new Date().toISOString(), error: e.message };
    console.error('Wetter-Fehler:', e.message);
    return false;
  }
}

/* ---------- HTTP ---------- */
async function handle(req, res, url, authSecret) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (!shared) await loadState();
    if (req.method === 'GET' && url.pathname === '/weather') {
      return json(200, { ok: true, ...compute(shared), moon: computeMoon(), source, webhook: !!WEBHOOK, last: lastResult, lastMoon: lastMoonResult });
    }
    if (req.method === 'GET' && url.pathname === '/weather/state') {
      return json(200, { ok: true, source, state: shared, current: compute(shared), moon: computeMoon(), loadedAt });
    }
    if (req.method === 'POST' && url.pathname === '/weather/moon-send') {
      const moon = await sendCurrentMoon();
      return json(200, { ok: true, moon, webhook: !!WEBHOOK });
    }
    if (req.method === 'POST' && url.pathname === '/weather/reload') {
      // nacheinander abarbeiten, damit schnelle Klicks im Menü keine Meldung verschlucken
      const job = reloadChain.then(async () => { await loadState(); return tick(); });
      reloadChain = job.catch(() => false);
      const sent = await job;
      return json(200, {
        ok: true,
        source,
        current: compute(shared),
        moon: computeMoon(),
        sent,
        webhook: !!WEBHOOK,
        last: lastResult,
        lastMoon: lastMoonResult
      });
    }
    if (req.method === 'GET' && url.pathname === '/weather/send') {
      if (!authSecret || url.searchParams.get('key') !== authSecret) return json(403, { ok: false, error: 'key falsch' });
      await loadState();
      const w = compute(shared);
      await send(shared, w);
      lastSentKey = w.key;
      lastResult = { ok: true, at: new Date().toISOString(), name: w.name, manual: true };
      return json(200, { ok: true, sent: w.name, webhook: true, last: lastResult });
    }
  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }
  return false;
}

function start(publicUrl) {
  loadState().then(() => {
    if (!WEBHOOK) { console.log('Wetter-Meldung aus (DISCORD_WEATHER_WEBHOOK nicht gesetzt).'); return; }
    console.log('Wetter-Meldung aktiv (' + source + ', alle ' + intervalText(shared.intervalMinutes) + ').');
    tick();
  });
  setInterval(() => { tick().catch(() => {}); }, 15 * 1000);
  // Sicherheitsnetz, falls ein Reload vom Menü verloren ging
  setInterval(() => { loadState().catch(() => {}); }, 30 * 60 * 1000);
  // Render Free schläft nach 15 Min ohne Aufruf ein → alle 10 Min selbst anpingen
  if (WEBHOOK && process.env.WEATHER_KEEPALIVE !== '0' && publicUrl) {
    setInterval(() => { fetch(publicUrl + '/auth/ping').catch(() => {}); }, 10 * 60 * 1000);
  }
}

module.exports = { start, handle, tick, tickMoon, sendCurrentMoon, compute, computeMoon, normalize };
