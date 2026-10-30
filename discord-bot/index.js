const {
  Client,
  GatewayIntentBits,
  Partials
} = require("discord.js");

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID || "1204906165004279889";

const OWNER = "XxleynaxX";
const REPO = "chronikenweb";
const BRANCH = "main";
const RAW_BASE = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/";

const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || "";
const BIN_IDS = {
  main: "6ae177efffd5d1605391bc4e",
  events: "6ae18121ffd5d1605391c7c7",
  map: "6ae28568ac6210605a5a8f1b"
};

if (!BOT_TOKEN) {
  console.error("DISCORD_BOT_TOKEN fehlt.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const EXCLUDED_FILES = new Set([
  "admin.html",
  "charakterbogen.html",
  "heilerakte.html"
]);

const EXCLUDED_PREFIXES = [
  ".github/",
  "discord-bot/",
  "node_modules/"
];

let knowledge = [];
let structured = {
  voelker: [],
  berufe: [],
  goetter: [],
  wetter: [],
  kreaturen: [],
  wiki: [],
  bibliothek: [],
  regeln: [],
  sonstiges: []
};

let lastKnowledgeUpdate = 0;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9äöü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(" ")
    .filter(word => word.length >= 2);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];

    for (let j = 0; j < b.length; j++) {
      const insert = cur[j] + 1;
      const remove = prev[j + 1] + 1;
      const replace = prev[j] + (a[i] === b[j] ? 0 : 1);
      cur.push(Math.min(insert, remove, replace));
    }

    prev = cur;
  }

  return prev[b.length];
}

function similar(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && (a.includes(b) || b.includes(a))) return 0.93;

  const max = Math.max(a.length, b.length);
  if (max < 3) return 0;

  return 1 - levenshtein(a, b) / max;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function addKnowledge(source, title, text, type = "page") {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 8) return;

  const item = {
    source,
    title: title || source,
    text: cleaned,
    type,
    tokens: tokenize(cleaned)
  };

  knowledge.push(item);
}

function addStructured(category, item, source) {
  if (!item || !item.name) return;

  const fields = [];
  for (const [key, value] of Object.entries(item)) {
    if (key === "name" || value == null || value === "") continue;

    if (Array.isArray(value)) {
      fields.push(key + ": " + value.join(", "));
    } else if (typeof value === "object") {
      fields.push(key + ": " + JSON.stringify(value));
    } else {
      fields.push(key + ": " + String(value));
    }
  }

  const text = item.name + (fields.length ? " | " + fields.join(" | ") : "");
  addKnowledge(source, item.name, text, "structured");
  structured[category].push({
    ...item,
    source
  });
}

function extractArrayBlock(source, constantName) {
  const match = source.match(
    new RegExp("const\\s+" + constantName + "\\s*=\\s*\\[(.*?)\\n\\s*\\];", "s")
  );

  return match ? match[1] : "";
}

function extractQuotedField(objectText, field) {
  const match = objectText.match(
    new RegExp(field + "\\s*:\\s*([\"'])([\\s\\S]*?)\\1")
  );

  return match ? match[2] : "";
}

function extractArrayField(objectText, field) {
  const match = objectText.match(
    new RegExp(field + "\\s*:\\s*\\[([\\s\\S]*?)\\]")
  );

  if (!match) return [];

  return [...match[1].matchAll(/["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(Boolean);
}

function parseObjectEntries(block) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;

      if (depth === 0 && start >= 0) {
        objects.push(block.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseChronikenData(source) {
  const definitions = [
    ["voelker", "DEFAULT_VOELKER"],
    ["berufe", "DEFAULT_BERUFE"],
    ["goetter", "DEFAULT_GOETTER"],
    ["wetter", "DEFAULT_WETTER"]
  ];

  for (const [category, constantName] of definitions) {
    const block = extractArrayBlock(source, constantName);
    if (!block) continue;

    for (const objectText of parseObjectEntries(block)) {
      const item = {};

      const fields = [
        "name",
        "emoji",
        "size",
        "age",
        "description",
        "strengths",
        "weaknesses",
        "category",
        "domain",
        "short",
        "full",
        "icon"
      ];

      for (const field of fields) {
        const value = extractQuotedField(objectText, field);
        if (value) item[field] = value;
      }

      const subraces = extractArrayField(objectText, "subraces");
      if (subraces.length) item.subraces = subraces;

      addStructured(category, item, "chroniken-data.js");
    }
  }
}

function parseHtmlPage(file, raw) {
  const titleMatch =
    raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
    raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  const title = titleMatch
    ? htmlToText(titleMatch[1])
    : file.replace(/\.html$/i, "");

  const text = htmlToText(raw);
  addKnowledge(file, title, text, "page");
}

function isAllowedFile(path) {
  if (!path || path.includes("..")) return false;

  const normalized = path.replace(/\\/g, "/");

  if (EXCLUDED_FILES.has(normalized)) return false;
  if (EXCLUDED_PREFIXES.some(prefix => normalized.startsWith(prefix))) return false;

  if (/^admin(?:\/|\.|$)/i.test(normalized)) return false;

  return (
    /\.html?$/i.test(normalized) ||
    normalized === "chroniken-data.js" ||
    /\.json$/i.test(normalized) ||
    /\.md$/i.test(normalized)
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Chroniken-Discord-Bot/2.0",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(response.status + " " + response.statusText);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Chroniken-Discord-Bot/2.0",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(response.status + " " + response.statusText);
  }

  return response.text();
}

async function discoverPublicFiles() {
  const url =
    "https://api.github.com/repos/" +
    OWNER +
    "/" +
    REPO +
    "/git/trees/" +
    BRANCH +
    "?recursive=1";

  const data = await fetchJson(url);

  return (data.tree || [])
    .filter(entry => entry.type === "blob")
    .map(entry => entry.path)
    .filter(isAllowedFile);
}

function addJsonRecord(value, source, prefix = "") {
  if (value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const name = item.name || item.title || item.id || "";
        const label = prefix ? prefix + (name ? " – " + name : "") : name;

        const fields = Object.entries(item)
          .filter(([key, val]) => val != null && val !== "" && key !== "id")
          .map(([key, val]) => {
            if (Array.isArray(val)) return key + ": " + val.join(", ");
            if (typeof val === "object") return key + ": " + JSON.stringify(val);
            return key + ": " + String(val);
          });

        addKnowledge(
          source,
          label || source,
          [label, ...fields].filter(Boolean).join(" | "),
          "json"
        );
      } else {
        addKnowledge(source, prefix || source, String(item), "json");
      }
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      addJsonRecord(child, source, prefix ? prefix + " / " + key : key);
    }
    return;
  }

  addKnowledge(source, prefix || source, String(value), "json");
}

async function loadJsonBin(binName, sourceLabel) {
  if (!JSONBIN_MASTER_KEY) {
    console.log("JSONBin nicht geladen: JSONBIN_MASTER_KEY ist nicht gesetzt.");
    return;
  }

  const id = BIN_IDS[binName];
  if (!id) return;

  const url = "https://api.jsonbin.io/v3/b/" + id + "/latest";

  try {
    const data = await fetchJson(url, {
      headers: {
        "X-Master-Key": JSONBIN_MASTER_KEY,
        "X-Bin-Meta": "false"
      }
    });

    const record = data && data.record !== undefined ? data.record : data;

    if (record && typeof record === "object") {
      addJsonRecord(record, sourceLabel);
    }

    console.log("JSONBin geladen:", binName);
  } catch (error) {
    console.warn("JSONBin konnte nicht geladen werden:", binName, error.message);
  }
}

function rebuildStructuredFromKnowledge() {
  // Dynamische HTML/JSON-Inhalte bleiben über knowledge verfügbar.
  // Strukturierte Default-Daten kommen aus chroniken-data.js.
}

async function loadKnowledge() {
  const nextKnowledge = [];
  const oldKnowledge = knowledge;

  knowledge = [];

  try {
    const files = await discoverPublicFiles();
    console.log("Öffentliche Wissensdateien:", files.length);

    for (const file of files) {
      try {
        const raw = await fetchText(RAW_BASE + file);

        if (file === "chroniken-data.js") {
          parseChronikenData(raw);
          addKnowledge(file, "Chroniken-Daten", raw, "data-source");
        } else if (/\.html?$/i.test(file)) {
          parseHtmlPage(file, raw);
        } else if (/\.json$/i.test(file)) {
          try {
            addJsonRecord(JSON.parse(raw), file);
          } catch {
            addKnowledge(file, file, raw, "json");
          }
        } else if (/\.md$/i.test(file)) {
          addKnowledge(file, file, raw, "markdown");
        }
      } catch (error) {
        console.warn("Datei konnte nicht geladen werden:", file, error.message);
      }
    }

    // Live-Daten aus den öffentlichen Inhalts-Bins.
    // Nur Main/Map/Events werden verwendet. Charakter- und Heilerdaten
    // bleiben bewusst außen vor, damit der Bot keine privaten Akten ausgibt.
    await loadJsonBin("main", "JSONBin Main");
    await loadJsonBin("map", "JSONBin Karte");
    await loadJsonBin("events", "JSONBin Events/Wetter");

    lastKnowledgeUpdate = Date.now();

    console.log(
      "Chroniken-Wissen geladen:",
      knowledge.length,
      "Einträge | strukturierte Völker:",
      structured.voelker.length,
      "| Berufe:",
      structured.berufe.length,
      "| Götter:",
      structured.goetter.length,
      "| Wetter:",
      structured.wetter.length
    );
  } catch (error) {
    console.error("Wissen konnte nicht vollständig geladen werden:", error);
  }

  if (!knowledge.length && oldKnowledge.length) {
    knowledge = oldKnowledge;
  }
}

function findBestStructured(category, query) {
  const items = structured[category] || [];
  const qTokens = tokenize(query);

  let best = null;

  for (const item of items) {
    const searchable = [
      item.name,
      item.description,
      item.strengths,
      item.weaknesses,
      item.domain,
      item.short,
      item.full,
      item.category,
      ...(item.subraces || [])
    ]
      .filter(Boolean)
      .join(" ");

    let score = 0;

    for (const q of qTokens) {
      for (const token of tokenize(searchable)) {
        score = Math.max(score, similar(q, token));
      }
    }

    const nameScore = Math.max(
      ...tokenize(item.name).map(nameToken =>
        Math.max(...qTokens.map(q => similar(q, nameToken)), 0)
      ),
      0
    );

    score = Math.max(score, nameScore);

    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  return best;
}

function wantsList(q, words) {
  const normalized = normalize(q);
  return words.some(word => normalized.includes(normalize(word)));
}

function formatList(title, items, url) {
  if (!items.length) return null;

  return (
    title +
    "\n" +
    items.map(item => "• " + (item.emoji ? item.emoji + " " : "") + item.name).join("\n") +
    "\n\nMehr dazu: " +
    url
  );
}

function formatDetails(item, url) {
  const lines = [];

  if (item.emoji) lines.push(item.emoji + " **" + item.name + "**");
  else lines.push("**" + item.name + "**");

  if (item.domain) lines.push("Bereich: " + item.domain);
  if (item.category) lines.push("Kategorie: " + item.category);
  if (item.size) lines.push("Größe: " + item.size);
  if (item.age) lines.push("Alter: " + item.age);
  if (item.subraces?.length) lines.push("Unterrassen: " + item.subraces.join(", "));
  if (item.description) lines.push("Beschreibung: " + item.description);
  if (item.strengths) lines.push("Stärken: " + item.strengths);
  if (item.weaknesses) lines.push("Schwächen: " + item.weaknesses);
  if (item.short) lines.push(item.short);
  if (item.full && item.full !== item.short) lines.push(item.full);

  lines.push("\nMehr dazu: " + url);
  return lines.join("\n");
}

function topicFromQuestion(message) {
  const q = normalize(message);

  const topics = [
    ["voelker", ["volk", "völker", "voelker", "rasse", "rassen"], "voelker.html"],
    ["berufe", ["beruf", "berufe", "beruffe", "arbeit", "hauptberuf", "nebenberuf"], "berufe.html"],
    ["goetter", ["gott", "gotter", "götter", "goetter", "gottheit", "gottheiten"], "goetter.html"],
    ["wetter", ["wetter", "regen", "schnee", "sturm", "nebel", "gewitter", "himmel"], "wetter.html"],
    ["kreaturen", ["kreatur", "kreaturen", "wesen", "bestie", "bestien"], "kreaturen.html"],
    ["wiki", ["wiki", "lore", "welt", "chronik", "chroniken"], "wiki.html"],
    ["bibliothek", ["bibliothek", "buch", "bücher", "buecher", "geschichte", "geschichten"], "bibliothek.html"],
    ["regeln", ["regel", "regeln", "erlaubt", "verbot", "verboten", "regelwerk"], "regeln.html"]
  ];

  let best = null;

  for (const [name, words, file] of topics) {
    for (const word of words) {
      const direct = similar(q, word);
      if (!best || direct > best.score) best = { name, file, score: direct };

      for (const token of tokenize(q)) {
        const score = similar(token, word);
        if (!best || score > best.score) best = { name, file, score };
      }
    }
  }

  return best && best.score >= 0.62 ? best : null;
}

function topicAnswer(message) {
  const topic = topicFromQuestion(message);
  if (!topic) return null;

  const q = normalize(message);
  const url = "https://xxleynaxx.github.io/chronikenweb/" + topic.file;

  if (topic.name === "berufe" && wantsList(q, ["welche", "welcher", "was für", "gibt es", "auflistung", "liste", "alle"])) {
    return formatList("📜 **Berufe in Chroniken:**", structured.berufe, url);
  }

  if (topic.name === "goetter" && wantsList(q, ["welche", "welcher", "was für", "gibt es", "auflistung", "liste", "alle"])) {
    return formatList("⛩️ **Götter in Chroniken:**", structured.goetter, url);
  }

  if (topic.name === "voelker" && wantsList(q, ["welche", "welcher", "was für", "gibt es", "auflistung", "liste", "alle"])) {
    return formatList("🧬 **Völker in Chroniken:**", structured.voelker, url);
  }

  if (topic.name === "wetter" && wantsList(q, ["welches", "wie ist", "aktuell", "jetzt"])) {
    const weatherRecords = knowledge.filter(item =>
      /wetter|weather/i.test(item.source) || item.source === "JSONBin Events/Wetter"
    );

    if (weatherRecords.length) {
      return (
        "🌦️ **Wetter in Chroniken:**\n" +
        weatherRecords.slice(0, 8).map(item => "• " + item.text).join("\n") +
        "\n\nMehr dazu: " + url
      );
    }
  }

  const best = findBestStructured(topic.name, message);

  if (best && best.score >= 0.48) {
    return formatDetails(best.item, url);
  }

  const topicEntries = knowledge
    .filter(item => item.source === topic.file)
    .slice(0, 5);

  if (topicEntries.length) {
    return (
      "📖 **Chroniken – " +
      topic.name +
      ":**\n" +
      topicEntries.map(item => "• " + item.text.slice(0, 500)).join("\n") +
      "\n\nMehr dazu: " +
      url
    );
  }

  return null;
}

function answerQuestion(message) {
  const topicAnswerText = topicAnswer(message);
  if (topicAnswerText) return topicAnswerText;

  const queryTokens = tokenize(message);
  if (!queryTokens.length) return null;

  const scored = knowledge
    .map(item => {
      let score = 0;
      let exactTokenHits = 0;

      for (const q of queryTokens) {
        for (const token of item.tokens) {
          const s = similar(q, token);
          if (s >= 0.9) exactTokenHits++;
          score = Math.max(score, s);
        }
      }

      const phrase = normalize(message);
      const textNorm = normalize(item.text);

      if (phrase.length >= 5 && textNorm.includes(phrase)) {
        score = Math.max(score, 0.99);
      }

      return { item, score, exactTokenHits };
    })
    .filter(x => x.score >= 0.68)
    .sort((a, b) => {
      if (b.exactTokenHits !== a.exactTokenHits) {
        return b.exactTokenHits - a.exactTokenHits;
      }
      return b.score - a.score;
    })
    .slice(0, 4);

  if (!scored.length) return null;

  return (
    "📖 **Aus den Chroniken:**\n" +
    scored.map(x => "• " + x.item.text.slice(0, 700)).join("\n") +
    "\n\nQuelle: https://xxleynaxx.github.io/chronikenweb/" + scored[0].item.source
  );
}

function isQuestion(message) {
  const q = String(message || "").trim();
  if (!q) return false;

  const normalized = normalize(q);

  return (
    q.includes("?") ||
    /^(wer|was|wie|wo|wann|welche|welcher|welches|wieviele|wie viele|gibt|haben wir|kann|können|koennen|ist|sind|wo finde ich|zeig|zeige|was für|was fuer)/.test(normalized)
  );
}

client.once("ready", async () => {
  console.log("Chroniken-Bot online als " + client.user.tag);

  await loadKnowledge();

  setInterval(() => {
    loadKnowledge().catch(error => {
      console.error("Wissens-Update fehlgeschlagen:", error);
    });
  }, 15 * 60 * 1000);
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.guild.id !== GUILD_ID) return;
  if (!isQuestion(message.content)) return;

  if (Date.now() - lastKnowledgeUpdate > 20 * 60 * 1000) {
    await loadKnowledge().catch(() => {});
  }

  const answer = answerQuestion(message.content);
  if (!answer) return;

  try {
    await message.reply({
      content: answer,
      allowedMentions: { repliedUser: false }
    });
  } catch (error) {
    console.error("Antwort konnte nicht gesendet werden:", error);
  }
});

client.login(BOT_TOKEN);
