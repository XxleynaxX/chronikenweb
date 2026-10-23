/**
 * Chroniken Wetter → Discord (GitHub Actions)
 *
 * Liest dieselben Wetterlagen wie die Website aus wetter-data.json
 * und wählt mit demselben zufälligen 6-Stunden-Slot wie wetter.js.
 * Dadurch bleibt das Wetter zwischen Website und Discord synchron.
 *
 * Secret: DISCORD_WEATHER_WEBHOOK
 * Optional: WEATHER_TITLE, WEATHER_TEXT (Platzhalter wie %wetter%)
 */

const fs = require("fs");
const path = require("path");

const SLOT_MS = 6 * 60 * 60 * 1000;

const DEFAULT_WEATHER = [
  ["Klarer Himmel", "☀️", "Ein ruhiger, heller Tag liegt über dem Land."],
  ["Leichter Wind", "🍃", "Ein sanfter Wind zieht durch Wälder und Gassen."],
  ["Bewölkt", "☁️", "Wolken ziehen über den Himmel, doch es bleibt trocken."],
  ["Nebel", "🌫️", "Dichter Nebel liegt über dem Land und verschluckt die Ferne."],
  ["Leichter Regen", "🌦️", "Feiner Regen fällt und lässt die Straßen glänzen."],
  ["Starker Regen", "🌧️", "Kräftiger Regen prasselt auf Dächer und Wege."],
  ["Gewitter", "⛈️", "Donner grollt am Horizont und Blitze erhellen die Wolken."],
  ["Starker Wind", "🌬️", "Böen ziehen durch das Land und lassen Äste rauschen."],
  ["Schneefall", "🌨️", "Leiser Schnee fällt vom Himmel und bedeckt die Landschaft."],
  ["Starker Schneefall", "❄️", "Dichter Schnee fällt und macht Wege langsam schwer passierbar."],
  ["Frost", "🥶", "Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft."],
  ["Dunstiger Morgen", "🌤️", "Heller Dunst liegt über dem Land und löst sich langsam auf."]
];

function loadWeatherList() {
  const candidates = [
    path.join(__dirname, "..", "..", "wetter-data.json"),
    path.join(process.cwd(), "wetter-data.json")
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const list = Array.isArray(raw) ? raw : raw.wetter;
      if (!Array.isArray(list) || !list.length) continue;
      const tuples = list
        .filter((w) => w && (w.name || (Array.isArray(w) && w[0])))
        .map((w) => {
          if (Array.isArray(w)) return [String(w[0]), String(w[1] || "🌦️"), String(w[2] || "")];
          return [String(w.name), String(w.icon || "🌦️"), String(w.description || "")];
        });
      if (tuples.length) {
        console.log(`Wetterlagen aus ${file} (${tuples.length} Einträge)`);
        return tuples;
      }
    } catch (e) {
      console.warn("Konnte wetter-data.json nicht lesen:", e.message);
    }
  }
  console.log("Fallback: eingebaute DEFAULT_WEATHER");
  return DEFAULT_WEATHER;
}

function slot() {
  return Math.floor(Date.now() / SLOT_MS);
}

/** Zufällige, aber synchronisierte Auswahl pro 6-Stunden-Slot. */
function randomIndex(seed, length) {
  let x = (seed * 1664525 + 1013904223) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x % length;
}

function pick(s, WEATHER) {
  if (WEATHER.length === 1) return WEATHER[0];

  let index = randomIndex(s, WEATHER.length);

  // Keine identische Wetterlage in zwei aufeinanderfolgenden Slots.
  const previousIndex = randomIndex(s - 1, WEATHER.length);
  if (index === previousIndex) {
    index = (index + 1 + randomIndex(s + 17, WEATHER.length - 1)) % WEATHER.length;
  }

  return WEATHER[index];
}

function msNext() {
  return SLOT_MS - (Date.now() % SLOT_MS);
}

function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}

function replaceVars(text, w) {
  const now = new Date();
  const next = format(msNext());
  const vars = {
    wetter: w[0],
    wetter_icon: w[1],
    wetter_beschreibung: w[2],
    naechster_wetterwechsel: next,
    datum: now.toLocaleDateString("de-DE"),
    zeit: now.toLocaleTimeString("de-DE")
  };
  return String(text || "").replace(/%([a-zA-Z0-9_]+)%/g, (_, k) =>
    vars[k] !== undefined ? vars[k] : "%" + k + "%"
  );
}

async function main() {
  const webhook = process.env.DISCORD_WEATHER_WEBHOOK;
  if (!webhook) {
    console.error("❌ DISCORD_WEATHER_WEBHOOK fehlt (GitHub Secret)");
    process.exit(1);
  }

  const WEATHER = loadWeatherList();
  const s = slot();
  const w = pick(s, WEATHER);

  const title = process.env.WEATHER_TITLE || "🌦️ Wetter in Chroniken";
  const text =
    process.env.WEATHER_TEXT ||
    "%wetter% ist jetzt bei Chroniken.\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%";

  const payload = {
    username: "Chroniken Wetter",
    embeds: [
      {
        title: replaceVars(title, w),
        description: replaceVars(text, w),
        color: 0x7c3aed,
        footer: { text: "Chroniken · Wetter" },
        timestamp: new Date().toISOString()
      }
    ]
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Discord Fehler:", res.status, body);
    process.exit(1);
  }

  console.log(`✅ Wetter gemeldet: ${w[1]} ${w[0]} (Slot ${s})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
