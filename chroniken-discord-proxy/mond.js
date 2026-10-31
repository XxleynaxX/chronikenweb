// ============================================================
// Chroniken – Mond (Proxy)
// Liest Phasen + Override aus MySQL (Key: moon), Fallback: Defaults.
// Sendet aktuelle Phase über DISCORD_WEATHER_WEBHOOK.
// ============================================================

const { discordFetch } = require('./discord-rate-limit');

let db = null;
try { db = require('./db'); } catch (e) {}

const WEBHOOK = String(process.env.DISCORD_WEATHER_WEBHOOK || '').trim();
const DEFAULT_START = new Date('2026-10-17T00:00:00').getTime();

const DEFAULT_PHASES = [
  { name: 'Neumond', icon: '🌑', description: 'Der Mond ist nicht am Himmel zu sehen.' },
  { name: 'Zunehmende Sichel', icon: '🌒', description: 'Ein schmaler Mondbogen wächst am Abendhimmel.' },
  { name: 'Halbmond', icon: '🌓', description: 'Der Mond zeigt seine halbe Scheibe.' },
  { name: 'Zunehmender Mond', icon: '🌔', description: 'Der Mond wird Nacht für Nacht heller.' },
  { name: 'Vollmond', icon: '🌕', description: 'Der volle Mond erhellt die Nacht.' },
  { name: 'Blutmond', icon: '🔴', description: 'Ein unheilvoller roter Mond steht über den Chroniken.' },
  { name: 'Abnehmender Mond', icon: '🌖', description: 'Das Licht des Mondes nimmt langsam ab.' },
  { name: 'Letzter Halbmond', icon: '🌗', description: 'Nur noch die Hälfte des Mondes bleibt sichtbar.' },
  { name: 'Abnehmende Sichel', icon: '🌘', description: 'Der Mond zieht sich langsam aus dem Nachthimmel zurück.' }
];

function cleanPhase(p) {
  p = p || {};
  return {
    name: String(p.name || '').trim() || 'Unbenannt',
    icon: String(p.icon || '').trim() || '🌑',
    description: String(p.description || '').trim()
  };
}

function normalize(raw) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const phases = Array.isArray(raw.phases) && raw.phases.length
    ? raw.phases.map(cleanPhase)
    : DEFAULT_PHASES.slice();
  return {
    phases,
    phaseDays: Math.max(1, Math.round(Number(raw.phaseDays) || 15)),
    start: Number(raw.start) || DEFAULT_START,
    forcedIndex: raw.forcedIndex == null || raw.forcedIndex === ''
      ? null
      : Math.max(0, Math.floor(Number(raw.forcedIndex))),
    forcedAt: Number(raw.forcedAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0
  };
}

async function loadState() {
  if (db && db.configured && db.configured()) {
    try {
      const value = await db.getOne('moon');
      if (value && typeof value === 'object') return normalize(value);
    } catch (e) {
      console.warn('[Mond] DB-Lesen fehlgeschlagen:', e.message);
    }
  }
  return normalize(null);
}

function computeFromState(st, now = Date.now()) {
  const phaseMs = st.phaseDays * 86400000;
  const n = st.phases.length || 1;
  let index, phaseStart, nextAt, forced;

  if (st.forcedIndex != null && st.forcedAt > 0) {
    const elapsed = Math.max(0, now - st.forcedAt);
    const steps = Math.floor(elapsed / phaseMs);
    index = (st.forcedIndex + steps) % n;
    phaseStart = st.forcedAt + steps * phaseMs;
    nextAt = phaseStart + phaseMs;
    forced = steps === 0;
  } else {
    const elapsed = Math.max(0, now - st.start);
    const phaseIndex = Math.floor(elapsed / phaseMs);
    index = phaseIndex % n;
    phaseStart = st.start + phaseIndex * phaseMs;
    nextAt = phaseStart + phaseMs;
    forced = false;
  }

  const phase = st.phases[index] || st.phases[0];
  return {
    index,
    name: phase.name,
    icon: phase.icon,
    description: phase.description,
    phaseStart,
    nextAt,
    phaseDays: st.phaseDays,
    forced,
    key: 'moon:' + Math.floor(phaseStart / 1000)
  };
}

async function getMoon(now = Date.now()) {
  const st = await loadState();
  return computeFromState(st, now);
}

async function discordRequest(payload) {
  if (!WEBHOOK) {
    throw new Error('DISCORD_WEATHER_WEBHOOK ist nicht gesetzt.');
  }
  const body = JSON.stringify(payload);
  const response = await discordFetch(WEBHOOK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });
  if (response.ok) {
    return { status: response.status, data: await response.text() };
  }
  throw new Error('Discord Webhook antwortete mit HTTP ' + response.status);
}

async function sendCurrentMoon() {
  const moon = await getMoon();
  await discordRequest({
    username: 'Die Chroniken – Mond',
    embeds: [{
      title: '🌙 Aktuelle Mondphase',
      description: moon.description,
      color: /blut/i.test(moon.name) ? 0xef4444 : 0x7c3aed,
      fields: [
        { name: 'Mondphase', value: moon.icon + ' ' + moon.name, inline: true },
        { name: 'Nächster Wechsel', value: new Date(moon.nextAt).toLocaleString('de-DE'), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
  return moon;
}

module.exports = {
  getMoon,
  sendCurrentMoon,
  loadState,
  computeFromState,
  normalize,
  DEFAULT_PHASES
};
