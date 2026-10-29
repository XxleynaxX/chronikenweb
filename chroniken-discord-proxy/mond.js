// ============================================================
// Chroniken – Mond-Discord
// Sendet die aktuell berechnete Mondphase über DISCORD_WEATHER_WEBHOOK.
// ============================================================

const https = require('https');

const WEBHOOK = String(process.env.DISCORD_WEATHER_WEBHOOK || '').trim();

const MOON_START = new Date('2026-10-17T00:00:00').getTime();
const PHASE_DAYS = 15;
const PHASE_MS = PHASE_DAYS * 24 * 60 * 60 * 1000;

const PHASES = [
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

function getMoon(now = Date.now()) {
  const elapsed = Math.max(0, now - MOON_START);
  const phaseIndex = Math.floor(elapsed / PHASE_MS) % PHASES.length;
  const phase = PHASES[phaseIndex];
  const phaseStart = MOON_START + Math.floor(elapsed / PHASE_MS) * PHASE_MS;
  const nextAt = phaseStart + PHASE_MS;

  return {
    index: phaseIndex,
    name: phase.name,
    icon: phase.icon,
    description: phase.description,
    phaseStart,
    nextAt,
    changedAt: phaseStart
  };
}

function discordRequest(payload) {
  if (!WEBHOOK) {
    throw new Error('DISCORD_WEATHER_WEBHOOK ist nicht gesetzt.');
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error('Discord Webhook antwortete mit HTTP ' + res.statusCode));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Discord Webhook Timeout.'));
    });
    req.write(body);
    req.end();
  });
}

async function sendCurrentMoon() {
  const moon = getMoon();

  await discordRequest({
    username: 'Die Chroniken – Mond',
    embeds: [{
      title: '🌙 Aktuelle Mondphase',
      description: moon.description,
      color: 0x7c3aed,
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
  sendCurrentMoon
};
