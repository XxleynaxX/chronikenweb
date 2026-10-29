/**
 * Conan Exiles Mod Watcher
 * Prüft Steam Workshop auf Updates und postet in EINEN Discord-Webhook.
 *
 * Env:
 *   DISCORD_WEBHOOK_URL  – Pflicht (dein Discord-Webhook)
 *   CHECK_INTERVAL_MIN   – optional, nur bei Dauerbetrieb (Standard: 180 = 3 Std.)
 *   QUIET                – "1" = nur bei Updates posten (Standard), "0" = auch "nichts neu"
 *   STATE_PATH           – optional, Pfad zur state.json (Standard: ./state.json)
 */

const fs = require("fs");
const path = require("path");

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";
const INTERVAL_MIN = Math.max(15, parseInt(process.env.CHECK_INTERVAL_MIN || "180", 10) || 180);
const QUIET = (process.env.QUIET || "1") !== "0";
const STATE_PATH = process.env.STATE_PATH || path.join(__dirname, "state.json");
const MODS_PATH = path.join(__dirname, "mods.json");

const STEAM_API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function formatDate(unix) {
  if (!unix) return "unbekannt";
  return new Date(unix * 1000).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function workshopUrl(id) {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
}

/** Steam erlaubt max. 100 IDs pro Request */
async function fetchDetails(ids) {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));

  const res = await fetch(STEAM_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`Steam API HTTP ${res.status}`);
  const data = await res.json();
  const list = data?.response?.publishedfiledetails;
  if (!Array.isArray(list)) throw new Error("Unerwartete Steam-Antwort");
  return list;
}

async function postDiscord(content, embeds) {
  if (!WEBHOOK) {
    console.log("[Discord] Kein WEBHOOK gesetzt – würde senden:", content);
    if (embeds) console.log(JSON.stringify(embeds, null, 2));
    return;
  }
  const payload = { content: content || undefined, embeds: embeds || undefined };
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Discord Webhook HTTP ${res.status}: ${t}`);
  }
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

  console.log(`[${new Date().toISOString()}] Prüfe ${ids.length} Mods …`);

  // In Chunks à 100 (Steam-Limit)
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  let details = [];
  for (const chunk of chunks) {
    const part = await fetchDetails(chunk);
    details = details.concat(part);
  }

  const updates = [];
  const newState = { ...state };

  for (const item of details) {
    const id = String(item.publishedfileid);
    if (item.result !== 1) {
      console.warn(`  ! ID ${id} nicht gefunden (result=${item.result})`);
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

    // Erster Lauf: nur speichern, nicht spammen
    if (prev == null) {
      console.log(`  · neu erfasst: ${title}`);
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
      console.log(`  ★ UPDATE: ${title}`);
    }
  }

  saveJson(STATE_PATH, newState);

  if (updates.length === 0) {
    console.log("  Keine Updates.");
    if (!QUIET) {
      await postDiscord(`✅ Mod-Check fertig – keine neuen Updates (${ids.length} Mods geprüft).`);
    }
    return;
  }

  // Discord: max. 10 Embeds pro Nachricht → ggf. aufteilen
  const chunksEmbed = [];
  for (let i = 0; i < updates.length; i += 10) {
    chunksEmbed.push(updates.slice(i, i + 10));
  }

  for (let c = 0; c < chunksEmbed.length; c++) {
    const batch = chunksEmbed[c];
    const embeds = batch.map((u) => ({
      title: `🔄 ${u.title}`,
      url: workshopUrl(u.id),
      color: 0x9b59b6,
      fields: [
        { name: "Vorher", value: formatDate(u.oldTime), inline: true },
        { name: "Jetzt", value: formatDate(u.newTime), inline: true },
        {
          name: "Workshop",
          value: `[Öffnen](${workshopUrl(u.id)})`,
          inline: true
        }
      ],
      footer: { text: `Workshop-ID ${u.id}` },
      timestamp: new Date(u.newTime * 1000).toISOString()
    }));

    const header =
      c === 0
        ? `**${updates.length} Mod-Update${updates.length > 1 ? "s" : ""}** erkannt`
        : `Updates (Teil ${c + 1}/${chunksEmbed.length})`;

    await postDiscord(header, embeds);
  }

  console.log(`  → ${updates.length} Update(s) an Discord gesendet.`);
}

async function main() {
  if (!WEBHOOK) {
    console.warn("⚠️  DISCORD_WEBHOOK_URL ist nicht gesetzt. Nachrichten werden nur geloggt.");
  }

  // Einmaliger Lauf (für Cron / GitHub Actions / manuell)
  if (process.env.ONCE === "1" || process.argv.includes("--once")) {
    await runOnce();
    return;
  }

  // Dauerbetrieb (Render Web Service): sofort + Intervall
  console.log(`Mod-Watcher gestartet. Intervall: ${INTERVAL_MIN} Minuten. Quiet=${QUIET}`);
  await runOnce();
  setInterval(() => {
    runOnce().catch((e) => console.error("Check fehlgeschlagen:", e));
  }, INTERVAL_MIN * 60 * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
