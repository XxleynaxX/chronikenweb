/**
 * Chroniken Wetter → Discord
 * Repliziert die Logik aus wetter.js (SLOT_MS = 6h, gleiche PRNG)
 * Läuft in GitHub Actions – ändert keine Website-Dateien.
 */

const SLOT_MS = 6 * 60 * 60 * 1000;

const DEFAULT_WEATHER = [
  ['Klarer Himmel', '☀️', 'Ein ruhiger, heller Tag liegt über dem Land.'],
  ['Leichter Wind', '🍃', 'Ein sanfter Wind zieht durch Wälder und Gassen.'],
  ['Bewölkt', '☁️', 'Wolken ziehen über den Himmel, doch es bleibt trocken.'],
  ['Nebel', '🌫️', 'Dichter Nebel liegt über dem Land und verschluckt die Ferne.'],
  ['Leichter Regen', '🌦️', 'Feiner Regen fällt und lässt die Straßen glänzen.'],
  ['Starker Regen', '🌧️', 'Kräftiger Regen prasselt auf Dächer und Wege.'],
  ['Gewitter', '⛈️', 'Donner grollt am Horizont und Blitze erhellen die Wolken.'],
  ['Starker Wind', '🌬️', 'Böen ziehen durch das Land und lassen Äste rauschen.'],
  ['Schneefall', '🌨️', 'Leiser Schnee fällt vom Himmel und bedeckt die Landschaft.'],
  ['Starker Schneefall', '❄️', 'Dichter Schnee fällt und macht Wege langsam schwer passierbar.'],
  ['Frost', '🥶', 'Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft.'],
  ['Dunstiger Morgen', '🌤️', 'Heller Dunst liegt über dem Land und löst sich langsam auf.']
];

function slot() {
  return Math.floor(Date.now() / SLOT_MS);
}

function pick(s) {
  let x = (s * 1103515245 + 12345) >>> 0;
  x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
  return DEFAULT_WEATHER[x % DEFAULT_WEATHER.length];
}

function msNext() {
  return SLOT_MS - (Date.now() % SLOT_MS);
}

function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function replaceVars(text, w) {
  const now = new Date();
  const next = format(msNext());
  const vars = {
    wetter: w[0],
    wetter_icon: w[1],
    wetter_beschreibung: w[2],
    naechster_wetterwechsel: next,
    datum: now.toLocaleDateString('de-DE'),
    zeit: now.toLocaleTimeString('de-DE')
  };
  return String(text || '').replace(/%([a-zA-Z0-9_]+)%/g, (_, k) =>
    vars[k] !== undefined ? vars[k] : `%${k}%`
  );
}

async function main() {
  const webhook = process.env.DISCORD_WEATHER_WEBHOOK;
  if (!webhook) {
    console.error('❌ DISCORD_WEATHER_WEBHOOK fehlt (GitHub Secret)');
    process.exit(1);
  }

  const s = slot();
  const w = pick(s);

  const title = process.env.WEATHER_TITLE || '🌦️ Wetter in Chroniken';
  const text = process.env.WEATHER_TEXT ||
    '%wetter% ist jetzt bei Chroniken.\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%';

  const payload = {
    username: 'Chroniken Wetter',
    embeds: [{
      title: replaceVars(title, w),
      description: replaceVars(text, w),
      color: 0x7c3aed,
      footer: { text: 'Chroniken · Wetter' },
      timestamp: new Date().toISOString()
    }]
  };

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Discord Fehler:', res.status, body);
    process.exit(1);
  }

  console.log(`✅ Wetter gemeldet: ${w[1]} ${w[0]} (Slot ${s})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
