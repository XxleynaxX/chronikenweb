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

const PUBLIC_FILES = [
  "index.html",
  "bibliothek.html",
  "wiki.html",
  "kreaturen.html",
  "berufe.html",
  "goetter.html",
  "voelker.html",
  "regeln.html",
  "news.html",
  "kalender.html",
  "events.html",
  "wetter.html",
  "chroniken-data.js"
];

const EXCLUDED = [
  "admin.html",
  "chroniken-admin.css",
  "admin",
  ".github",
  "node_modules",
  "discord-bot"
];

let knowledge = [];
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
    .filter(x => x.length >= 3);
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
  if (a.includes(b) || b.includes(a)) return 0.92;

  const max = Math.max(a.length, b.length);
  if (max < 4) return 0;

  return 1 - levenshtein(a, b) / max;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<svg[\\s\\S]*?<\\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\s+/g, " ")
    .trim();
}

function cleanText(text) {
  return String(text || "")
    .replace(/\\s+/g, " ")
    .replace(/\\n+/g, " ")
    .trim();
}

function splitKnowledge(text, source) {
  const cleaned = cleanText(text);
  if (!cleaned) return;

  const parts = cleaned
    .split(/(?<=[.!?])\\s+(?=[A-ZÄÖÜ0-9])/)
    .map(x => x.trim())
    .filter(x => x.length >= 25);

  for (const part of parts) {
    knowledge.push({
      source,
      text: part,
      tokens: tokenize(part)
    });
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Chroniken-Discord-Bot/1.0" }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

async function loadKnowledge() {
  const next = [];

  for (const file of PUBLIC_FILES) {
    if (EXCLUDED.some(x => file === x || file.startsWith(x))) continue;

    const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${file}`;

    try {
      const raw = await fetchText(url);
      const text = file.endsWith(".html") ? stripHtml(raw) : raw;

      const old = knowledge;
      knowledge = [];
      splitKnowledge(text, file);
      next.push(...knowledge);
      knowledge = old;
    } catch (error) {
      console.warn("Wissensdatei konnte nicht geladen werden:", file, error.message);
    }
  }

  knowledge = next;
  lastKnowledgeUpdate = Date.now();

  console.log(`Chroniken-Wissen geladen: ${knowledge.length} Einträge.`);
}

function findTopic(message) {
  const q = normalize(message);

  const topics = [
    {
      name: "berufe",
      words: ["beruf", "berufe", "beruffe", "arbeit", "hauptberuf", "nebenberuf"],
      file: "berufe.html"
    },
    {
      name: "goetter",
      words: ["gott", "gotter", "götter", "goetter", "gottheit", "gottheiten"],
      file: "goetter.html"
    },
    {
      name: "voelker",
      words: ["volk", "völker", "voelker", "rasse", "rassen"],
      file: "voelker.html"
    },
    {
      name: "kreaturen",
      words: ["kreatur", "kreaturen", "wesen", "bestie", "bestien", "tier"],
      file: "kreaturen.html"
    },
    {
      name: "wetter",
      words: ["wetter", "regen", "schnee", "sturm", "nebel", "gewitter", "himmel"],
      file: "wetter.html"
    },
    {
      name: "regeln",
      words: ["regel", "regeln", "erlaubt", "verbot", "verboten", "regelwerk"],
      file: "regeln.html"
    },
    {
      name: "wiki",
      words: ["wiki", "wissen", "lore", "chronik", "chroniken", "welt"],
      file: "wiki.html"
    },
    {
      name: "bibliothek",
      words: ["bibliothek", "buch", "bücher", "buecher", "geschichte", "geschichten"],
      file: "bibliothek.html"
    },
    {
      name: "kalender",
      words: ["kalender", "datum", "termin", "termine", "ereignis", "ereignisse"],
      file: "kalender.html"
    }
  ];

  let best = null;

  for (const topic of topics) {
    for (const word of topic.words) {
      const score = similar(q, word);
      if (!best || score > best.score) {
        best = { ...topic, score };
      }

      for (const token of tokenize(q)) {
        const tokenScore = similar(token, word);
        if (!best || tokenScore > best.score) {
          best = { ...topic, score: tokenScore };
        }
      }
    }
  }

  return best && best.score >= 0.65 ? best : null;
}

function extractNamedItems(topic) {
  const source = knowledge.filter(x => x.source === topic.file);
  if (!source.length) return [];

  const joined = source.map(x => x.text).join(" ");
  const patterns = {
    berufe: /(?:Tierpfleger|Feinschmied|Bogner|Alchemist|Waffenschmied|Rüstungsschmied|Mönch und Priester|Heiler|Schneider|Koch und Wirt|Sucher nach Arbeitern|Landwirt)/gi,
    goetter: /(?:Aurelion|Nyxara|Thalor|Veyra|Mordak|Syleth)/gi,
    voelker: /(?:Mensch|Elf|Zwerg|Orc|Kitsune|Wolf|Troll|Tiefling|Gnom|Halbling|Minotaurus|Drachengeborener|Dämon|Fee|Halbgigant|Goblin|Wasserwesen|Vogelwesen|Tierwesen|Halborc|Halbelf|Wargwandler)/gi
  };

  const pattern = patterns[topic.name];
  if (!pattern) return [];

  return [...new Set(joined.match(pattern) || [])];
}

function topicAnswer(topic) {
  const names = extractNamedItems(topic);

  if (topic.name === "berufe" && names.length) {
    return `📜 **Berufe in Chroniken:**\\n${names.map(x => `• ${x}`).join("\\n")}\\n\\nMehr dazu: https://xxleynaxx.github.io/chronikenweb/berufe.html`;
  }

  if (topic.name === "goetter" && names.length) {
    return `⛩️ **Götter in Chroniken:**\\n${names.map(x => `• ${x}`).join("\\n")}\\n\\nMehr dazu: https://xxleynaxx.github.io/chronikenweb/goetter.html`;
  }

  if (topic.name === "voelker" && names.length) {
    return `🧬 **Völker in Chroniken:**\\n${names.map(x => `• ${x}`).join("\\n")}\\n\\nMehr dazu: https://xxleynaxx.github.io/chronikenweb/voelker.html`;
  }

  const entries = knowledge
    .filter(x => x.source === topic.file)
    .slice(0, 4)
    .map(x => x.text);

  if (entries.length) {
    return `📖 **Chroniken – ${topic.name}:**\\n${entries.map(x => `• ${x}`).join("\\n")}\\n\\nMehr dazu: https://xxleynaxx.github.io/chronikenweb/${topic.file}`;
  }

  return null;
}

function answerQuestion(message) {
  const topic = findTopic(message);
  if (topic) {
    const answer = topicAnswer(topic);
    if (answer) return answer;
  }

  const queryTokens = tokenize(message);
  if (!queryTokens.length) return null;

  const scored = knowledge
    .map(item => {
      let score = 0;
      for (const q of queryTokens) {
        for (const t of item.tokens) {
          score = Math.max(score, similar(q, t));
        }
      }
      return { item, score };
    })
    .filter(x => x.score >= 0.72)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return null;

  return `📖 **Aus den Chroniken:**\\n${scored.map(x => `• ${x.item.text}`).join("\\n")}\\n\\nQuelle: https://xxleynaxx.github.io/chronikenweb/${scored[0].item.source}`;
}

function isQuestion(message) {
  const q = normalize(message);
  if (!q) return false;

  return (
    q.includes("?") ||
    /^(wer|was|wie|wo|wann|welche|welcher|welches|wieviele|wie viele|gibt|gibt es|haben wir|kann|können|koennen|ist|sind|wo finde ich|zeig|zeige)/.test(q)
  );
}

client.once("ready", async () => {
  console.log(`Chroniken-Bot online als ${client.user.tag}`);

  try {
    await loadKnowledge();
  } catch (error) {
    console.error("Wissen konnte nicht geladen werden:", error);
  }

  setInterval(() => {
    loadKnowledge().catch(error => console.error("Wissens-Update fehlgeschlagen:", error));
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
