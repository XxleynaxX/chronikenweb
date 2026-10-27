/**
 * Chroniken Wetter → Discord
 *
 * Kern-Logik identisch zu wetter.js:
 *   - Config aus weather-config.js (Repo)
 *   - gleicher Slot (intervalHours)
 *   - gleiche gewichtete Auswahl
 *
 * Wird alle 15 Min vom Workflow gestartet.
 * Sendet NUR, wenn wir am Anfang eines neuen Slots sind
 * (Timer praktisch auf 0) – sonst Exit ohne Discord-Post.
 *
 * Secret: DISCORD_WEATHER_WEBHOOK
 * Optional: WEATHER_TITLE, WEATHER_TEXT
 */

const path = require("path");

const CONFIG = require(path.join(__dirname, "..", "..", "weather-config.js"));

const INTERVAL_HOURS = Math.max(1, Number(CONFIG.intervalHours) || 6);
const SLOT_MS = INTERVAL_HOURS * 60 * 60 * 1000;

/**
 * Fenster nach Slot-Start, in dem gemeldet wird.
 * GitHub Actions-Cron ist oft mehrere Minuten verspätet – deshalb
 * deutlich größer als das 15-Min-Intervall (sonst wird nie gepostet).
 */
const NOTIFY_WINDOW_MS = 45 * 60 * 1000;

const WEATHER = (CONFIG.weather || []).map(function (w) {
  return {
    name: String(w.name || "Unbekannt"),
    icon: String(w.icon || "🌤️"),
    description: String(w.description || ""),
    weight: Math.max(0, Number(w.weight) || 0)
  };
});

if (!WEATHER.length) {
  console.error("❌ Keine Wetterlagen in weather-config.js");
  process.exit(1);
}

function slot() {
  return Math.floor(Date.now() / SLOT_MS);
}

function msIntoSlot() {
  return Date.now() % SLOT_MS;
}

function msNext() {
  return SLOT_MS - msIntoSlot();
}

/** Exakt wie wetter.js */
function randomIndex(seed, length) {
  let x = (seed * 1103515245 + 12345) >>> 0;
  x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
  return x % length;
}

/** Exakt wie wetter.js – gewichtet */
function pickWeighted(seed, list) {
  const total = list.reduce(function (sum, w) {
    return sum + Math.max(0, Number(w.weight) || 0);
  }, 0);

  if (total <= 0) {
    return list[randomIndex(seed, list.length)] || list[0];
  }

  let r = randomIndex(seed, total);
  for (let i = 0; i < list.length; i++) {
    r -= Math.max(0, Number(list[i].weight) || 0);
    if (r < 0) return list[i];
  }
  return list[list.length - 1];
}

function getWeatherState() {
  const s = slot();
  const w = pickWeighted(s, WEATHER);
  return {
    slot: s,
    name: w.name,
    icon: w.icon,
    description: w.description,
    changedAt: new Date(s * SLOT_MS).toISOString()
  };
}

function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0")
  );
}

function replaceVars(text, weather) {
  const now = new Date();
  const vars = {
    wetter: weather.name,
    wetter_icon: weather.icon,
    wetter_beschreibung: weather.description,
    naechster_wetterwechsel: format(msNext()),
    datum: now.toLocaleDateString("de-DE"),
    zeit: now.toLocaleTimeString("de-DE")
  };

  return String(text || "").replace(/%([a-zA-Z0-9_]+)%/g, function (_, key) {
    return vars[key] !== undefined ? vars[key] : "%" + key + "%";
  });
}

const fs = require("fs");
const SLOT_MARKER = path.join(__dirname, ".last-weather-slot");

function readLastSlot() {
  try {
    const raw = fs.readFileSync(SLOT_MARKER, "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastSlot(s) {
  try {
    fs.writeFileSync(SLOT_MARKER, String(s), "utf8");
  } catch (e) {
    console.warn("Slot-Marker konnte nicht geschrieben werden:", e.message);
  }
}

async function main() {
  const into = msIntoSlot();
  const weather = getWeatherState();

  // Nur am Slot-Anfang melden (Timer ≈ 0)
  if (into > NOTIFY_WINDOW_MS) {
    console.log(
      `⏭ Kein Slot-Wechsel (noch ${format(msNext())} bis Timer 0). ` +
        `Aktuell: ${weather.icon} ${weather.name} (Slot ${weather.slot}). Skip.`
    );
    process.exit(0);
  }

  // Doppelpost vermeiden (Cache + Marker über Workflow-Läufe)
  const last = readLastSlot();
  if (last !== null && last === weather.slot) {
    console.log(
      `⏭ Slot ${weather.slot} wurde bereits gemeldet (${weather.icon} ${weather.name}). Skip.`
    );
    process.exit(0);
  }

  const webhook = process.env.DISCORD_WEATHER_WEBHOOK;
  if (!webhook) {
    console.error("❌ DISCORD_WEATHER_WEBHOOK fehlt.");
    process.exit(1);
  }

  const title =
    process.env.WEATHER_TITLE || "🌦️ Wetter in Chroniken";

  const text =
    process.env.WEATHER_TEXT ||
    "%wetter_icon% %wetter% ist jetzt bei Chroniken.\n\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%";

  const payload = {
    username: "Chroniken Wetter",
    embeds: [
      {
        title: replaceVars(title, weather),
        description: replaceVars(text, weather),
        color: 0x7c3aed,
        footer: {
          text: "Chroniken · Wetter · Intervall " + INTERVAL_HOURS + "h"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("Discord Fehler:", response.status, body);
    process.exit(1);
  }

  writeLastSlot(weather.slot);

  console.log(
    `✅ Slot-Wechsel gemeldet: ${weather.icon} ${weather.name} ` +
      `(Slot ${weather.slot}, Intervall ${INTERVAL_HOURS}h, ${Math.floor(into / 1000)}s nach Start)`
  );
}

main().catch(function (error) {
  console.error("❌ Wetter-Fehler:", error);
  process.exit(1);
});
