/**
 * Conan Exiles Mod Watcher
 * Prüft Steam Workshop auf Updates und sendet sie an deinen Render-Proxy.
 * Der echte Discord-Webhook liegt NUR auf Render (Env: MOD_WEBHOOK).
 *
 * Env:
 *   RENDER_NOTIFY_URL   – z.B. https://chronikenweb-1.onrender.com/mod-update
 *   CHECK_INTERVAL_MIN  – optional (Standard 180)
 *   QUIET               – "1" = nur bei Updates (Standard)
 *   STATE_PATH          – optional
 *   ONCE=1              – einmaliger Lauf (Cron / Actions)
 */

const fs = require("fs");
const path = require("path");

const RENDER_URL = (process.env.RENDER_NOTIFY_URL || process.env.NOTIFY_URL || "https://chronikenweb-1.onrender.com/mod-update").replace(/\/$/, "");
const INTERVAL_MIN = Math.max(15, parseInt(process.env.CHECK_INTERVAL_MIN || "180", 10) || 180);
const QUIET = (process.env.QUIET || "1") !== "0";
const STATE_PATH = process.env.STATE_PATH || path.join(__dirname, "state.json");
const MODS_PATH = path.join(__dirname, "mods.json");

const STEAM_API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

async function fetchDetails(ids) {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
  const res = await fetch(STEAM_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error("Steam API HTTP " + res.status);
  const data = await res.json();
  const list = data?.response?.publishedfiledetails;
  if (!Array.isArray(list)) throw new Error("Unerwartete Steam-Antwort");
  return list;
}

/** Sendet an Render → Render schickt an Discord-Webhook */
async function notifyRender(payload) {
  console.log("[Notify]", RENDER_URL);
  const res = await fetch(RENDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Render notify HTTP " + res.status + ": " + text);
  try { return JSON.parse(text); } catch { return { ok: true }; }
}

async function runOnce() {
  const mods = loadJson(MODS_PATH, []);
  if (!mods.length) {
    console.error("mods.json ist leer oder fehlt.");
    return;
  }

  const state = loadJson(STATE_PATH, {});
  const ids = mods.map((m) => String(m.id));
  const nameById = Object.fromEntries(mods.map((m) => [String(m.id), m.name]));

  console.log("[" + new Date().toISOString() + "] Prüfe " + ids.length + " Mods …");

  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  let details = [];
  for (const chunk of chunks) {
    details = details.concat(await fetchDetails(chunk));
  }

  const updates = [];
  const newState = { ...state };

  for (const item of details) {
    const id = String(item.publishedfileid);
    if (item.result !== 1) {
      console.warn("  ! ID " + id + " nicht gefunden (result=" + item.result + ")");
      continue;
    }
    const timeUpdated = Number(item.time_updated) || 0;
    const title = item.title || nameById[id] || id;
    const prev = state[id];

    newState[id] = {
      title,
      time_updated: timeUpdated,
      file_size: item.file_size,
      checked_at: Math.floor(Date.now() / 1000)
    };

    if (prev == null) {
      console.log("  · neu erfasst: " + title);
      continue;
    }

    if (timeUpdated > (prev.time_updated || 0)) {
      updates.push({
        id,
        title,
        oldTime: prev.time_updated,
        newTime: timeUpdated,
        size: item.file_size
      });
      console.log("  ★ UPDATE: " + title);
    }
  }

  saveJson(STATE_PATH, newState);

  if (updates.length === 0) {
    console.log("  Keine Updates.");
    if (!QUIET) {
      await notifyRender({ content: "✅ Mod-Check fertig – keine neuen Updates (" + ids.length + " Mods)." });
    }
    return;
  }

  // In Batches à 10 (Discord Embed-Limit)
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const header =
      i === 0
        ? "**" + updates.length + " Mod-Update" + (updates.length > 1 ? "s" : "") + "** erkannt"
        : "Updates (Teil " + (Math.floor(i / 10) + 1) + ")";
    await notifyRender({ content: header, updates: batch });
  }

  console.log("  → " + updates.length + " Update(s) an Render/Discord gesendet.");
}

async function main() {
  console.log("Notify-URL:", RENDER_URL);

  if (process.env.ONCE === "1" || process.argv.includes("--once")) {
    await runOnce();
    return;
  }

  console.log("Mod-Watcher gestartet. Intervall: " + INTERVAL_MIN + " Min. Quiet=" + QUIET);
  await runOnce();
  setInterval(() => {
    runOnce().catch((e) => console.error("Check fehlgeschlagen:", e));
  }, INTERVAL_MIN * 60 * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
