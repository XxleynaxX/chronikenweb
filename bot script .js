const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const http = require('http');

loadEnv(path.join(__dirname, 'config.env'));

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '';
// Daten kommen jetzt aus der MySQL-Datenbank (über den Chroniken-Proxy), nicht mehr aus JSONBin.
const DATA_API_URL = (process.env.CHRONIKEN_DATA_URL || 'https://chronikenweb-1.onrender.com/data').replace(/\/$/, '');
// Discord-Rollen, die der Bot auf Anfrage der Charakterverwaltung vergibt/entfernt
// Wer /char benutzen darf: nur diese Rollen (per CHAR_COMMAND_ROLE_IDS in config.env änderbar)
const ADMIN_ROLE_IDS = (process.env.CHAR_COMMAND_ROLE_IDS || '1300216664113156116,1251121611130540063,1301646276877615176,1297961769574334555')
  .split(',').map(x => x.trim()).filter(Boolean);
const HEALER_ROLE_ID = process.env.HEALER_ROLE_ID || '1562596034243461150';
const LIB_ROLE_ID = process.env.LIB_ROLE_ID || '1564874876236472470';
const BOT_API_PORT = Number(process.env.BOT_API_PORT || 14071);
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

// ===== TICKET-SYSTEM =====
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '';
const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || '';
const TICKET_STAFF_ROLE_IDS = (process.env.TICKET_STAFF_ROLE_IDS || process.env.CHAR_COMMAND_ROLE_IDS || '1300216664113156116,1251121611130540063,1301646276877615176,1297961769574334555')
  .split(',').map(x => x.trim()).filter(Boolean);
const TICKET_LIMIT_PER_USER = Number(process.env.TICKET_LIMIT_PER_USER || 2);
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '1204906165444550740';
const WELCOME_IMAGE = path.join(__dirname, 'welcome-book.jpg');

const TICKETS_FILE = path.join(__dirname, 'tickets.json');
const ROLES_PANELS_FILE = path.join(__dirname, 'roles-panels.json');

// Gespeicherte Button-/Reaction-Rollen Panels (über Dashboard editierbar)
let savedRolePanels = [];
function loadRolePanels() {
  try {
    if (fs.existsSync(ROLES_PANELS_FILE)) {
      savedRolePanels = JSON.parse(fs.readFileSync(ROLES_PANELS_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.warn('Rollen-Panels laden fehlgeschlagen:', e.message);
    savedRolePanels = [];
  }
}
function saveRolePanels() {
  try {
    fs.writeFileSync(ROLES_PANELS_FILE, JSON.stringify(savedRolePanels, null, 2));
  } catch (e) {
    console.warn('Rollen-Panels speichern fehlgeschlagen:', e.message);
  }
}

loadRolePanels();

// Willkommens-Einstellungen (Dashboard)
const WELCOME_SETTINGS_FILE = path.join(__dirname, 'welcome-settings.json');
let welcomeSettings = {
  channelId: process.env.WELCOME_CHANNEL_ID || '1204906165444550740',
  title: '📖 Ein neuer Name wird in die Chroniken geschrieben…',
  description:
    `Die Seiten schlagen auf.\nPurpurnes Licht flackert über dem Pergament.\n\n### Willkommen, **{name}**\n\n{mention} – dein Kapitel beginnt **jetzt**.\n\n> *„Jeder Wanderer, der diese Welt betritt, hinterlässt eine Spur. Die Chroniken vergessen niemanden.“*\n\nDu bist **Mitglied #{memberCount}** in den Chroniken.\nLies die Regeln, wähle deine Rollen und tritt ein in die zerbrochenen Welten.`,
  content: '✨ {mention} betritt die Welt der Chroniken.',
  footer: 'Die Chroniken · RP',
  color: 0xa855f7,
  imageUrl: '', // optional externe URL; sonst lokale welcome-book.jpg
  enabled: true
};

function loadWelcomeSettings() {
  try {
    if (fs.existsSync(WELCOME_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WELCOME_SETTINGS_FILE, 'utf8'));
      welcomeSettings = { ...welcomeSettings, ...data };
    }
  } catch (e) {
    console.warn('Welcome-Settings laden fehlgeschlagen:', e.message);
  }
}
function saveWelcomeSettings() {
  try {
    fs.writeFileSync(WELCOME_SETTINGS_FILE, JSON.stringify(welcomeSettings, null, 2));
  } catch (e) {
    console.warn('Welcome-Settings speichern fehlgeschlagen:', e.message);
  }
}
loadWelcomeSettings();

function fillWelcomeTemplate(str, ctx) {
  return String(str || '')
    .replace(/\{name\}/g, ctx.name || '')
    .replace(/\{mention\}/g, ctx.mention || '')
    .replace(/\{memberCount\}/g, String(ctx.memberCount ?? ''))
    .replace(/\{tag\}/g, ctx.tag || '')
    .replace(/\{id\}/g, ctx.id || '');
}

async function sendWelcomeMessage(member, options = {}) {
  const channelId = options.channelId || welcomeSettings.channelId || WELCOME_CHANNEL_ID;
  if (!channelId || welcomeSettings.enabled === false && !options.force) return null;

  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Welcome-Channel nicht gefunden: ' + channelId);
  }

  const name = member.displayName || member.user.username;
  const ctx = {
    name,
    mention: `<@${member.id}>`,
    memberCount: member.guild.memberCount,
    tag: member.user.tag,
    id: member.id
  };

  const created = Math.floor(member.user.createdTimestamp / 1000);
  const embed = new EmbedBuilder()
    .setColor(typeof welcomeSettings.color === 'number' ? welcomeSettings.color : 0xa855f7)
    .setTitle(fillWelcomeTemplate(welcomeSettings.title, ctx))
    .setDescription(fillWelcomeTemplate(welcomeSettings.description, ctx))
    .addFields(
      {
        name: '🗡️ Nächste Schritte',
        value: '• Regeln lesen\n• Rollen wählen\n• Charakter anlegen\n• Bei Fragen: Ticket öffnen',
        inline: true
      },
      {
        name: '📜 Account',
        value: `Discord seit <t:${created}:D>`,
        inline: true
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: fillWelcomeTemplate(welcomeSettings.footer || 'Die Chroniken · RP', ctx) })
    .setTimestamp();

  const payload = {
    content: fillWelcomeTemplate(welcomeSettings.content || '', ctx) || undefined,
    embeds: [embed]
  };

  // Bild: externe URL oder lokale Datei
  if (welcomeSettings.imageUrl && /^https?:\/\//i.test(welcomeSettings.imageUrl)) {
    embed.setImage(welcomeSettings.imageUrl);
  } else if (fs.existsSync(WELCOME_IMAGE)) {
    const { AttachmentBuilder } = require('discord.js');
    const file = new AttachmentBuilder(WELCOME_IMAGE, { name: 'willkommen-chroniken.jpg' });
    embed.setImage('attachment://willkommen-chroniken.jpg');
    payload.files = [file];
  }

  return channel.send(payload);
}




const TICKET_TYPES_DEFAULT = [
  { id: 'support', label: 'Support', emoji: '🛠️', description: 'Allgemeine Hilfe & Fragen', buttonStyle: 1 },
  { id: 'report', label: 'Report', emoji: '🚨', description: 'Spieler / Regelverstoß melden', buttonStyle: 4 },
  { id: 'charakter', label: 'Charakter', emoji: '📜', description: 'Charakterbogen, Rollen, Genehmigung', buttonStyle: 1 },
  { id: 'sonstiges', label: 'Sonstiges', emoji: '📩', description: 'Alles andere', buttonStyle: 2 }
];

// tickets.bot-ähnliche Panel-/Ticket-Einstellungen
const TICKET_SETTINGS_FILE = path.join(__dirname, 'ticket-settings.json');
let ticketSettings = {
  panelTitle: '🎫 Support – Ticket erstellen',
  panelDescription:
    'Brauchst du Hilfe? Wähle eine Kategorie und öffne ein privates Ticket.\nNur du und das Team können den Channel sehen.',
  panelColor: 0xa855f7,
  panelFooter: 'Chroniken · Ticket-System',
  ticketWelcome:
    'Hallo {mention}!\n\nDein **{type}**-Ticket wurde erstellt.\nBeschreibe dein Anliegen bitte so genau wie möglich – ein Team-Mitglied meldet sich gleich.\n\n**Ticket-ID:** `{channel}`',
  mentionStaffOnOpen: true,
  namingPattern: 'ticket-{type}-{username}', // placeholders: type, username, id
  types: TICKET_TYPES_DEFAULT
};

function loadTicketSettings() {
  try {
    if (fs.existsSync(TICKET_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TICKET_SETTINGS_FILE, 'utf8'));
      ticketSettings = { ...ticketSettings, ...data };
      if (!Array.isArray(ticketSettings.types) || !ticketSettings.types.length) {
        ticketSettings.types = TICKET_TYPES_DEFAULT;
      }
    }
  } catch (e) {
    console.warn('Ticket-Settings laden fehlgeschlagen:', e.message);
  }
}
function saveTicketSettings() {
  try {
    fs.writeFileSync(TICKET_SETTINGS_FILE, JSON.stringify(ticketSettings, null, 2));
  } catch (e) {
    console.warn('Ticket-Settings speichern fehlgeschlagen:', e.message);
  }
}
loadTicketSettings();

function getTicketTypes() {
  return ticketSettings.types || TICKET_TYPES_DEFAULT;
}


// Offene Tickets: channelId -> { userId, type, claimedBy, createdAt, name }
let openTickets = new Map();

function loadTickets() {
  try {
    if (fs.existsSync(TICKETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
      openTickets = new Map(Object.entries(data || {}));
    }
  } catch (e) {
    console.warn('Tickets konnten nicht geladen werden:', e.message);
  }
}

function saveTickets() {
  try {
    const obj = Object.fromEntries(openTickets);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('Tickets konnten nicht gespeichert werden:', e.message);
  }
}

loadTickets();

const SITE = 'https://xxleynaxx.github.io/chronikenweb/';
const DATA_JS = SITE + 'chroniken-data.js';

// ===== SERVER-INFOS =====
const SERVER_INFO = {
  kurzinfo: 'Willkommen in den **Chroniken** – Conan Exiles Roleplay. Charakterbögen, Götter, Völker, Berufe und die ganze Welt findest du auf der Website.',
  website: 'https://xxleynaxx.github.io/chronikenweb/',
  modsJsonUrl: 'https://raw.githubusercontent.com/XxleynaxX/chronikenweb/main/chroniken-discord-proxy/mod-watcher/mods.json',
  weatherApiUrl: 'https://chronikenweb-1.onrender.com/weather'
};

// Cache für Live-Wetter + Mond
let weatherCache = { data: null, updated: 0 };
const WEATHER_CACHE_MS = 60 * 1000; // 1 Minute

async function loadWeather() {
  if (Date.now() - weatherCache.updated < WEATHER_CACHE_MS && weatherCache.data) {
    return weatherCache.data;
  }

  try {
    const res = await fetch(SERVER_INFO.weatherApiUrl, {
      headers: { 'User-Agent': 'ChronikenDiscordBot/6.1' }
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();

    if (data && data.ok !== false) {
      weatherCache = {
        data,
        updated: Date.now()
      };

      return data;
    }
  } catch (e) {
    console.warn('Wetter-API nicht erreichbar:', e.message);
  }

  return weatherCache.data;
}

function formatDateDe(iso) {
  if (!iso) return null;

  try {
    return new Date(iso).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return null;
  }
}

function formatLiveWeather(data) {
  if (!data) return null;

  const icon = data.icon || '🌤️';
  const name = data.name || 'Unbekannt';
  const desc = data.description || '';
  const next = formatDateDe(data.nextChangeAt);

  let out = `**Aktuelles Wetter:** ${icon} **${name}**`;

  if (desc) out += `\n${desc}`;
  if (next) out += `\nNächster Wechsel: ${next}`;

  return out;
}

function formatLiveMoon(data) {
  if (!data || !data.moon) return null;

  const m = data.moon;
  const icon = m.icon || '🌙';
  const name = m.name || 'Unbekannt';
  const desc = m.description || '';
  const next = formatDateDe(m.nextChangeAt);

  let out = `**Aktueller Mond:** ${icon} **${name}**`;

  if (desc) out += `\n${desc}`;
  if (next) out += `\nNächster Mondwechsel: ${next}`;

  return out;
}

// Cache für die Mod-Liste (Conan Exiles Workshop)
let modsCache = { list: [], updated: 0 };
const MODS_CACHE_MS = 10 * 60 * 1000; // 10 Minuten

async function loadMods() {
  if (Date.now() - modsCache.updated < MODS_CACHE_MS && modsCache.list.length) {
    return modsCache.list;
  }

  try {
    const res = await fetch(SERVER_INFO.modsJsonUrl, {
      headers: { 'User-Agent': 'ChronikenDiscordBot/6.0' }
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();

    if (Array.isArray(data)) {
      modsCache = {
        list: data,
        updated: Date.now()
      };

      return data;
    }
  } catch (e) {
    console.warn('Mods-Liste konnte nicht geladen werden:', e.message);
  }

  return modsCache.list;
}

function formatModsList(mods) {
  if (!mods || !mods.length) {
    return 'Aktuell konnte ich die Mod-Liste nicht laden. Versuch es gleich nochmal oder frag einen Admin.';
  }

  const names = mods.map(m => m.name || m.id).filter(Boolean);
  const lines = names.map(n => `• ${n}`);

  return `**Aktuell installierte Conan-Exiles-Mods (${names.length}):**

${lines.join('\n')}

Bei Updates meldet sich der Mod-Watcher automatisch.`;
}

if (!TOKEN || TOKEN === 'HIER_DEIN_BOT_TOKEN_EINTRAGEN') {
  console.error('Kein Discord Bot Token in config.env eingetragen.');
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error('Keine DISCORD_CHANNEL_ID in config.env eingetragen.');
  process.exit(1);
}

const PUBLIC_PAGES = [
  ['Startseite', 'index.html'],
  ['Berufe', 'berufe.html'],
  ['Völker', 'voelker.html'],
  ['Götter', 'goetter.html'],
  ['Kreaturen', 'kreaturen.html'],
  ['Wetter', 'wetter.html'],
  ['Wiki', 'wiki.html'],
  ['Bibliothek', 'bibliothek.html'],
  ['Regeln', 'regeln.html'],
  ['News', 'news.html'],
  ['Kalender', 'kalender.html'],
  ['Events', 'events.html'],
  ['Karte', 'karte.html']
];

let knowledge = {
  updated: 0,
  docs: [],
  entities: [],
  categories: {},
  structured: {
    voelker: [],
    berufe: [],
    goetter: [],
    wetter: []
  }
};

// Einfaches Kurzzeit-Gedächtnis pro Channel
const memory = new Map();
const MEMORY_SIZE = 6;
const MEMORY_TTL = 8 * 60 * 1000;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();

    if (!s || s.startsWith('#')) continue;

    const i = s.indexOf('=');

    if (i < 1) continue;

    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();

    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }

    if (!process.env[k]) {
      process.env[k] = v;
    }
  }
}

function normalize(s = '') {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9äöü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return normalize(s)
    .split(/\s+/)
    .filter(x => x.length >= 2);
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const row = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  );

  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const old = row[j];

      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );

      prev = old;
    }
  }

  return row[b.length];
}

function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;
  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) return 0.92;

  if (a.length < 3 || b.length < 3) return 0;

  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]) : fallback;
}

function extractBlocks(html) {
  const out = [];

  const re = /<(h[1-6]|article|section|li|p|blockquote|td|th|dt|dd|div)[^>]*>([\s\S]*?)<\/\1>/gi;

  let m;

  const junk =
    /wetter verwalten|timer neu starten|dieses wetter setzen|wetterlagen speichern|minuten stunden tage|admin änderungen|render-proxy|chance =|neues wetter|timer speichern|wetter überspringen/i;

  while ((m = re.exec(html))) {
    const text = stripHtml(m[2]);

    if (
      text.length >= 12 &&
      text.length <= 1800 &&
      !junk.test(text)
    ) {
      out.push(text);
    }
  }

  return [...new Set(out)].slice(0, 900);
}

function parseStructuredData(js) {
  const result = {
    voelker: [],
    berufe: [],
    goetter: [],
    wetter: []
  };

  function extractArray(marker) {
    const start = js.indexOf(marker);

    if (start < 0) return [];

    const end = js.indexOf('];', start);

    if (end < 0) return [];

    const chunk = js.slice(start, end + 1);

    const objects = [];

    const objRe = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

    let m;

    while ((m = objRe.exec(chunk))) {
      const body = m[1];

      const name =
        (
          body.match(
            /name\s*:\s*["'`]([^"'`]+)/
          ) || []
        )[1];

      if (!name) continue;

      const obj = { name };

      const fields = [
        'emoji',
        'size',
        'age',
        'description',
        'strengths',
        'weaknesses',
        'domain',
        'icon',
        'title',
        'beschreibung',
        'category',
        'short',
        'full'
      ];

      for (const f of fields) {
        const re = new RegExp(
          f + '\\s*:\\s*["\'`]([^"\'`]*)',
          'i'
        );

        const match = body.match(re);

        if (match) {
          obj[f] = match[1];
        }
      }

      const sub = body.match(
        /subraces\s*:\s*\[([^\]]*)\]/i
      );

      if (sub) {
        obj.subraces = [
          ...sub[1].matchAll(/["'`]([^"'`]+)["'`]/g)
        ].map(x => x[1]);
      }

      objects.push(obj);
    }

    return objects;
  }

  result.voelker = extractArray('DEFAULT_VOELKER');
  result.berufe = extractArray('DEFAULT_BERUFE');
  result.goetter = extractArray('DEFAULT_GOETTER');
  result.wetter = extractArray('DEFAULT_WETTER');

  return result;
}

function parseStaticData(js) {
  const docs = [];
  const structured = parseStructuredData(js);

  for (const [cat, list] of Object.entries(structured)) {
    for (const item of list) {
      const parts = [];

      if (item.description) {
        parts.push(item.description);
      }

      if (item.strengths) {
        parts.push('Stärken: ' + item.strengths);
      }

      if (item.weaknesses) {
        parts.push('Schwächen: ' + item.weaknesses);
      }

      if (item.domain) {
        parts.push('Domäne: ' + item.domain);
      }

      if (item.size) {
        parts.push('Größe: ' + item.size);
      }

      if (item.age) {
        parts.push('Alter: ' + item.age);
      }

      if (item.subraces?.length) {
        parts.push(
          'Unterarten: ' + item.subraces.join(', ')
        );
      }

      const text = parts.join(' | ') || item.name;

      docs.push({
        page:
          cat === 'voelker'
            ? 'Völker'
            : cat === 'berufe'
              ? 'Berufe'
              : cat === 'goetter'
                ? 'Götter'
                : 'Wetter',
        title: item.name,
        text,
        blocks: parts,
        structured: item
      });
    }
  }

  return {
    docs,
    structured
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ChronikenDiscordBot/6.0'
    }
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${url}`);
  }

  return await res.text();
}

async function fetchChronikenData() {
  try {
    const res = await fetch(DATA_API_URL, {
      headers: { 'User-Agent': 'ChronikenDiscordBot/7.0', 'Cache-Control': 'no-cache' }
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const body = await res.json();

    return body && body.data && typeof body.data === 'object'
      ? body.data
      : null;
  } catch (e) {
    console.warn('Datenbank (Proxy /data) nicht erreichbar:', e.message);
    return null;
  }
}

// Wandelt strukturierte Listen (Völker/Berufe/Götter/Wetter) in Wissens-Dokumente um
function structuredToDocs(structured) {
  const docs = [];
  const pageNames = {
    voelker: 'Völker',
    berufe: 'Berufe',
    goetter: 'Götter',
    wetter: 'Wetter'
  };

  for (const [cat, list] of Object.entries(structured)) {
    for (const item of list) {
      const parts = [];

      if (item.description) parts.push(item.description);
      if (item.short) parts.push(item.short);
      if (item.full && item.full !== item.short) parts.push(item.full);
      if (item.strengths) parts.push('Stärken: ' + item.strengths);
      if (item.weaknesses) parts.push('Schwächen: ' + item.weaknesses);
      if (item.domain) parts.push('Domäne: ' + item.domain);
      if (item.size) parts.push('Größe: ' + item.size);
      if (item.age) parts.push('Alter: ' + item.age);
      if (item.subraces?.length) parts.push('Unterarten: ' + item.subraces.join(', '));

      docs.push({
        page: pageNames[cat] || cat,
        title: item.name,
        text: parts.join(' | ') || item.name,
        blocks: parts,
        structured: item
      });
    }
  }

  return docs;
}

// Reduziert einen DB-Eintrag auf die Felder, die der Bot kennt
function toEntity(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = String(raw.name || raw.title || raw.titel || '').trim();
  if (!name) return null;

  const obj = { name };

  for (const f of [
    'emoji', 'icon', 'size', 'age', 'description', 'strengths',
    'weaknesses', 'domain', 'title', 'beschreibung', 'category',
    'short', 'full'
  ]) {
    if (typeof raw[f] === 'string' && raw[f].trim()) obj[f] = raw[f].trim();
  }

  if (!obj.description && obj.beschreibung) obj.description = obj.beschreibung;

  if (Array.isArray(raw.subraces)) {
    obj.subraces = raw.subraces.map(x => String(x)).filter(Boolean);
  }

  return obj;
}

function walkJson(value, category, docs, depth = 0) {
  if (depth > 7 || value == null) return;

  if (typeof value === 'string') {
    if (value.trim().length >= 8) {
      docs.push({
        page: category,
        title: category,
        text: value.trim(),
        blocks: [value.trim()]
      });
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(
        item,
        category,
        docs,
        depth + 1
      );
    }

    return;
  }

  if (typeof value === 'object') {
    const title =
      value.name ||
      value.titel ||
      value.title ||
      value.bezeichnung ||
      value.id ||
      category;

    const parts = [];

    for (const [k, v] of Object.entries(value)) {
      if (['id', '_id'].includes(k)) continue;

      if (typeof v === 'string' && v.trim()) {
        parts.push(`${k}: ${v.trim()}`);
      }
    }

    if (parts.length) {
      docs.push({
        page: category,
        title: String(title),
        text: parts.join(' | '),
        blocks: parts
      });
    }

    for (const [k, v] of Object.entries(value)) {
      walkJson(
        v,
        category,
        docs,
        depth + 1
      );
    }
  }
}

function addDoc(
  docs,
  page,
  title,
  text,
  blocks = []
) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return;

  docs.push({
    page,
    title: String(title || page),
    text: clean.slice(0, 5000),
    blocks: blocks
      .filter(Boolean)
      .slice(0, 80)
  });
}

async function refreshKnowledge() {
  const docs = [];

  const jobs = PUBLIC_PAGES.map(
    async ([page, file]) => {
      try {
        const html = await fetchText(
          SITE + file
        );

        const blocks = extractBlocks(html);

        addDoc(
          docs,
          page,
          titleFromHtml(html, page),
          blocks.join(' | '),
          blocks
        );
      } catch (e) {
        console.warn(
          'Seite konnte nicht geladen werden:',
          page,
          e.message
        );
      }
    }
  );

  await Promise.all(jobs);

  let structured = {
    voelker: [],
    berufe: [],
    goetter: [],
    wetter: []
  };

  try {
    const js = await fetchText(DATA_JS);

    const parsed = parseStaticData(js);

    docs.push(...parsed.docs);

    structured = parsed.structured;
  } catch (e) {
    console.warn(
      'chroniken-data.js nicht geladen:',
      e.message
    );
  }

  // ===== Live-Daten aus der Datenbank =====
  const dbData = await fetchChronikenData();

  if (dbData) {
    // Strukturierte Listen aus der DB überschreiben die statischen Standardwerte,
    // sobald dort Einträge vorhanden sind.
    const mapStructured = {
      voelker: dbData.races,
      berufe: dbData.professions,
      goetter: dbData.gods
    };

    for (const [cat, raw] of Object.entries(mapStructured)) {
      if (Array.isArray(raw) && raw.length) {
        const list = raw.map(toEntity).filter(Boolean);

        if (list.length) {
          structured[cat] = list;

          // alte, aus chroniken-data.js erzeugte Docs dieser Kategorie entfernen
          const pageName = { voelker: 'Völker', berufe: 'Berufe', goetter: 'Götter' }[cat];

          for (let k = docs.length - 1; k >= 0; k--) {
            if (docs[k].structured && docs[k].page === pageName) docs.splice(k, 1);
          }

          docs.push(...structuredToDocs({ [cat]: list }));
        }
      }
    }

    const textKeys = [
      ['wiki', 'Wiki'],
      ['creatures', 'Kreaturen'],
      ['library', 'Bibliothek'],
      ['rules', 'Regeln'],
      ['news', 'News'],
      ['events', 'Events'],
      ['calendar', 'Kalender']
    ];

    for (const [key, label] of textKeys) {
      if (dbData[key]) walkJson(dbData[key], label, docs);
    }

    // Aktuelles Wetter/Mond-Objekt aus der DB
    if (dbData.weather && typeof dbData.weather === 'object') {
      walkJson(dbData.weather, 'Wetter', docs);
    }
  } else {
    console.warn('Keine Datenbank-Daten – es werden nur Website-Texte und Standardwerte genutzt.');
  }

  const seen = new Set();

  const unique = docs.filter(d => {
    const key = normalize(
      d.page +
      '|' +
      d.title +
      '|' +
      d.text.slice(0, 350)
    );

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });

  const entities = [];

  for (const d of unique) {
    const title = d.title.trim();

    if (
      title.length >= 2 &&
      title.length <= 100
    ) {
      entities.push({
        name: title,
        page: d.page,
        text: d.text
      });
    }
  }

  knowledge = {
    updated: Date.now(),
    docs: unique,
    entities,
    categories: buildCategories(unique),
    structured
  };

  console.log(
    `Chroniken-Wissen aktualisiert: ${unique.length} Textbausteine | Völker:${structured.voelker.length} Berufe:${structured.berufe.length} Götter:${structured.goetter.length}`
  );

  try {
    if (client && client.isReady()) {
      updatePresence().catch(() => {});
    }
  } catch {}
}

function buildCategories(docs) {
  const result = {};

  for (const d of docs) {
    const key = normalize(d.page);

    if (!result[key]) {
      result[key] = [];
    }

    result[key].push(d);
  }

  return result;
}

// ===== MAGIE =====

const MAGIC_INFO = {
  maxSchulen: 2,
  extraRp: true,

  schulen: [
    { name: 'Feuer', icon: '🔥' },
    { name: 'Wasser', icon: '💧' },
    { name: 'Erde', icon: '🪨' },
    { name: 'Luft', icon: '🌪️' },
    { name: 'Blitz', icon: '⚡' },
    { name: 'Eis', icon: '❄️' },
    { name: 'Licht', icon: '✨' },
    { name: 'Schatten', icon: '🌙' },
    { name: 'Arkan', icon: '🔮' },
    { name: 'Blutmagie', icon: '🩸' },
    { name: 'Illusionsmagie', icon: '✨' },
    { name: 'Sonder-/RP-Magie', icon: '🌟' }
  ],

  regeln: [
    'Maximal **zwei** Magiearten pro Charakter.',
    'Zusätzlich kann **eine** reine RP-/Sonder-Magie gewählt werden.',
    'Keine gegensätzlichen Magien kombinieren (z. B. **Wasser + Feuer**).',
    'Magie braucht eine glaubwürdige Quelle und hat immer einen **Preis** (Nebenwirkungen).',
    'Wirkung nur mit **Konsens** aller Beteiligten – Magie ist nicht allmächtig.',
    'Muss zur Hintergrundgeschichte des Charakters passen.'
  ]
};

function formatMagicAnswer(query) {
  const q = normalize(query);
  const lines = [];

  lines.push(
    '**Magie in den Chroniken** (laut Charakterbogen / Serverregeln):'
  );

  lines.push('');

  lines.push(
    '**Erlaubte Schulen** (max. 2 + optional RP-Magie):'
  );

  lines.push(
    MAGIC_INFO.schulen
      .map(s => `• ${s.icon} ${s.name}`)
      .join('\n')
  );

  lines.push('');

  lines.push('**Regeln:**');

  lines.push(
    MAGIC_INFO.regeln
      .map(r => `• ${r}`)
      .join('\n')
  );

  if (/nebenwirkung|preis|kosten/.test(q)) {
    lines.push('');

    lines.push(
      'Jede Nutzung hat einen Preis (z. B. Erschöpfung, Narben, Mangelerscheinungen) – Details stehen in den Magieregeln auf dem Charakterbogen.'
    );
  }

  lines.push('');

  lines.push(
    'Mehr steht im Charakterbogen unter **Magie & Fähigkeiten** / Magieregeln.'
  );

  return lines.join('\n');
}

function filterBerufeByKind(kind) {
  const list =
    knowledge.structured.berufe || [];

  if (!kind) return list;

  const want =
    kind === 'haupt'
      ? 'hauptberuf'
      : 'nebenberuf';

  return list.filter(b =>
    normalize(b.category || '').includes(
      want.replace('beruf', '')
    ) ||
    normalize(b.category || '') === want
  );
}

const ALIASES = {
  berufe: [
    'beruf',
    'berufe',
    'hauptberuf',
    'haubtberuf',
    'nebenberuf',
    'job',
    'jobs',
    'arbeit',
    'arbeiten',
    'handwerk',
    'klasse',
    'profession',
    'klassen',
    'haupt',
    'haubt'
  ],

  voelker: [
    'volk',
    'voelker',
    'rasse',
    'rassen',
    'volker',
    'spezies',
    'art',
    'völker'
  ],

  goetter: [
    'gott',
    'götter',
    'goetter',
    'gottheit',
    'gottheiten',
    'glaube',
    'glauben',
    'religion',
    'kult',
    'kulte'
  ],

  kreaturen: [
    'kreatur',
    'kreaturen',
    'wesen',
    'bestie',
    'bestien',
    'monster',
    'tier',
    'tiere'
  ],

  wetter: [
    'wetter',
    'regen',
    'schnee',
    'sturm',
    'nebel',
    'sonne',
    'mond',
    'blutmond',
    'nacht'
  ],

  wiki: [
    'wiki',
    'wissen',
    'lore',
    'welt',
    'chroniken'
  ],

  bibliothek: [
    'bibliothek',
    'buch',
    'bücher',
    'buecher',
    'geschichte',
    'geschichten'
  ],

  regeln: [
    'regel',
    'regeln',
    'darf',
    'erlaubt',
    'verbot',
    'verboten',
    'muss'
  ],

  news: [
    'news',
    'neuigkeit',
    'neuigkeiten',
    'ankündigung',
    'ankuendigung'
  ],

  kalender: [
    'kalender',
    'datum',
    'termin',
    'monat',
    'tage'
  ],

  events: [
    'event',
    'events',
    'veranstaltung'  ],

  karte: [
    'karte',
    'map',
    'ort',
    'orte',
    'wo',
    'finden'
  ]
};

const STOP = new Set(
  'ich du der die das den dem des ein eine einer einem einen und oder aber ist sind bin soll sollst kann kannst wie was wer welcher welche welchen welchem warum wo wann für fuer von zu mit im in auf an es mir mich mein meine meiner nehmen glauben weiß weiss nicht haben hat gibt gibt es mehr über ueber passt passt zu suche such wissen info information bitte mal hey hi hallo'.split(' ')
);

function categoryScore(query, aliases) {
  const qt = tokens(query);

  let score = 0;

  for (const a of aliases) {
    for (const q of qt) {
      const sim = similarity(q, a);

      if (sim >= 0.88) {
        score += sim >= 0.98 ? 3 : 1.5;
      }
    }
  }

  return score;
}

function inferCategory(query) {
  const q = normalize(query);

  if (
    /hauptberuf|haubtberuf|nebenberuf|beruf|handwerk|profession/.test(q)
  ) {
    return 'berufe';
  }

  if (
    /voelker|völker|volk|rasse|rassen|spezies/.test(q)
  ) {
    return 'voelker';
  }

  if (
    /goetter|götter|gott|gottheit|glaube|religion|kult/.test(q)
  ) {
    return 'goetter';
  }

  if (
    /kreatur|bestie|monster|wesen/.test(q)
  ) {
    return 'kreaturen';
  }

  if (
    /wetter|regen|schnee|sturm|nebel/.test(q)
  ) {
    return 'wetter';
  }

  if (
    /regel|verbot|erlaubt/.test(q)
  ) {
    return 'regeln';
  }

  const scores = Object.entries(ALIASES).map(
    ([cat, words]) => [
      cat,
      categoryScore(query, words)
    ]
  );

  scores.sort((a, b) => b[1] - a[1]);

  return scores[0] && scores[0][1] >= 1.5
    ? scores[0][0]
    : null;
}

function queryEntityTokens(query) {
  return tokens(query).filter(
    t => !STOP.has(t)
  );
}

function docScore(
  query,
  doc,
  preferredCategory
) {
  const q = queryEntityTokens(query);

  if (!q.length) return 0;

  const text = normalize(
    `${doc.title} ${doc.page} ${doc.text}`
  );

  const title = normalize(
    `${doc.title} ${doc.page}`
  );

  let score = 0;

  for (const word of q) {
    if (title.includes(word)) {
      score += 8;
    } else if (text.includes(word)) {
      score += 3;
    } else {
      const parts = text.split(/\s+/);
      let best = 0;

      for (const p of parts.slice(0, 500)) {
        best = Math.max(
          best,
          similarity(word, p)
        );
      }

      if (best >= 0.84) {
        score += best * 1.8;
      }
    }
  }

  if (
    preferredCategory &&
    normalize(doc.page).includes(
      normalize(preferredCategory)
    )
  ) {
    score += 7;
  }

  return score;
}

function intent(query) {
  const q = normalize(query);

  return {
    count:
      /\b(wie viel|wieviele|wie viele|anzahl|zahl|wie viele gibt|gibt es wie viele)\b/.test(q),

    list:
      /\b(welche|was fuer|was für|aufzaehl|aufzähl|liste|alle|gibt es|was gibt|was ist da|was gibt es|zeig|zeige)\b/.test(q) ||
      /hauptberuf|haubtberuf|nebenberuf/.test(q),

    advantage:
      /\b(vorteil|vorteile|bonus|bonis|staerke|stärke|gut daran|bringt mir|was bringt)\b/.test(q),

    disadvantage:
      /\b(nachteil|nachteile|schwaeche|schwäche|problem|schlecht daran)\b/.test(q),

    recommendation:
      /\b(weiss nicht|weiß nicht|entscheiden|entscheidung|nehmen soll|nehmen|passt zu mir|geeignet|empfehl|welcher passt|was soll ich|welche.*nehmen)\b/.test(q),

    where:
      /\b(wo|finden|seite|link)\b/.test(q),

    current:
      /\b(gerade|aktuell|jetzt|heute|momentan)\b/.test(q),

    more:
      /\b(erzaehl|erzähl|erklaer|erklär|beschreib|infos|information|mehr ueber|mehr über|details)\b/.test(q),

    greeting:
      /^(hey|hi|hallo|moin|servus|guten (tag|abend|morgen)|yo|na)\b/.test(q) ||
      (q.length < 12 &&
        /^(hey|hi|hallo)/.test(q)),

    help:
      /\b(hilfe|help|was kannst du|was kannst|befehle|commands)\b/.test(q),

    mods:
      /\b(mod|mods|modifikation|modifikationen|plugin|plugins|addon|addons)\b/.test(q),

    website:
      /\b(website|seite|link|homepage|webseite)\b/.test(q),

    moon:
      /\b(mond|monde|mondphase|mondphasen|neumond|vollmond|blutmond|halbmond)\b/.test(q),

    weatherNow:
      /\b(wetter|regen|schnee|sturm|nebel|sonne|aktuell.*wetter|wie.*wetter|welches.*wetter)\b/.test(q),

    magic:
      /\b(magie|magisch|zauber|elementarmagie|blutmagie|illusionsmagie|magieschule|magieschulen|magieregel)\b/.test(q)
  };
}

function looksRelevant(query) {
  const q = normalize(query);

  if (!q) return false;

  if (
    /\b(bot|lern|kind|dumm|doof|test|lol|haha|xd|omg)\b/.test(q) &&
    !inferCategory(q) &&
    !intent(query).mods &&
    !intent(query).moon &&
    !intent(query).weatherNow &&
    !intent(query).help
  ) {
    const loreHit =
      inferCategory(q) ||
      queryEntityTokens(q).some(
        t => t.length >= 4
      );

    if (!loreHit) return false;
  }

  if (inferCategory(q)) return true;

  if (
    intent(query).mods ||
    intent(query).moon ||
    intent(query).weatherNow ||
    intent(query).magic ||
    intent(query).help ||
    intent(query).greeting
  ) {
    return true;
  }

  if (
    /[?]/.test(query) &&
    queryEntityTokens(q).length >= 1
  ) {
    return true;
  }

  const i = intent(q);

  if (
    i.list ||
    i.count ||
    i.recommendation ||
    i.advantage ||
    i.disadvantage ||
    i.more
  ) {
    return true;
  }

  return (
    queryEntityTokens(q).length >= 2 &&
    /(welch|was|wie|wo|wer|such|brauch|möcht|möchte|will|erzaehl|erzähl|hauptberuf|beruf|gott|volk)/.test(q)
  );
}

function isJunkText(t = '') {
  const n = normalize(t);

  return (
    /escapehtml|\\$\{|toLocaleString|regeln bearbeiten|json format|daten json|speichern abbrechen|klicke auf eine kachel|portal gelten|admin|bearbeiten bauregeln/.test(n) ||
    /\$\{/.test(t) ||
    (
      n.includes('chroniken start news events') &&
      n.includes('charakterbogen')
    )
  );
}

function bestDocs(query, category) {
  const pool = knowledge.docs.filter(
    d =>
      !isJunkText(d.text) &&
      !isJunkText(d.title)
  );

  return pool
    .map(d => ({
      d,
      s: docScore(
        query,
        d,
        category
      )
    }))
    .filter(x => x.s > 1.2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
}

/**
 * Konfidenz 0–100 aus Score + Trefferanzahl
 */
function confidenceFromHits(
  hits,
  query
) {
  if (!hits.length) return 0;

  const top = hits[0].s;
  const second =
    hits[1] ? hits[1].s : 0;

  let c = Math.min(
    95,
    Math.round(
      top * 8 +
      (top - second) * 3
    )
  );

  if (hits.length === 1 && top < 5) {
    c = Math.min(c, 40);
  }

  if (top < 3) {
    c = Math.min(c, 35);
  }

  if (top >= 12) {
    c = Math.max(c, 70);
  }

  if (top >= 20) {
    c = Math.max(c, 85);
  }

  if (inferCategory(query)) {
    c = Math.min(98, c + 8);
  }

  return Math.max(
    5,
    Math.min(98, c)
  );
}

function compact(text, max = 900) {
  let s = text
    .replace(/\s+/g, ' ')
    .trim();

  if (s.length <= max) return s;

  return (
    s
      .slice(0, max - 1)
      .replace(/\s+\S*$/, '') +
    '…'
  );
}

function uniqueStrings(arr) {
  return [
    ...new Set(
      arr
        .map(x => x.trim())
        .filter(Boolean)
    )
  ];
}

function findNames(category) {
  const key = normalize(category);

  const map = {
    berufe: knowledge.structured.berufe,
    voelker: knowledge.structured.voelker,
    goetter: knowledge.structured.goetter,
    wetter: knowledge.structured.wetter
  };

  if (map[key]?.length) {
    return map[key]
      .map(x => x.name)
      .filter(Boolean);
  }

  const docs =
    knowledge.categories[key] || [];

  const names = docs
    .map(d => d.title)
    .filter(
      n => n && n.length < 100
    );

  return uniqueStrings(names).filter(
    n =>
      !/^die chroniken|^chroniken/i.test(n)
  );
}

// ===== PERSÖNLICHKEIT =====

const OPENINGS = {
  default: [
    'Ich hab mal in den Chroniken nachgesehen…',
    'Lass mich kurz in den Aufzeichnungen blättern.',
    'Gute Frage. Ich schau mal, was die Chroniken dazu sagen.',
    'Moment, ich wühle kurz in den alten Texten…',
    'Die Chroniken haben dazu einiges parat.'
  ],

  recommendation: [
    'Okay, dann lass uns das mal vernünftig anschauen.',
    'Gute Wahl, dass du nachfragst – ich helfe dir gerne weiter.',
    'Ich schau mir an, was am besten zu dem passen könnte, was du suchst.',
    'Dann werfen wir mal einen Blick auf die Möglichkeiten.'
  ],

  list: [
    'Klar, hier die Übersicht:',
    'Ich hab dir die wichtigsten Einträge rausgesucht:',
    'So sieht’s aktuell aus:'
  ],

  greeting: [
    'Moin. Ich bin der Chronist – frag mich ruhig zu Göttern, Völkern, Berufen oder was dir sonst auf der Seele brennt.',
    'Hey. Was möchtest du über die Chroniken wissen?',
    'Willkommen. Die Aufzeichnungen sind bereit – schieß los.'
  ]
};

const CLOSINGS = {
  default: [
    'Falls du zu einem Eintrag mehr Details willst, frag einfach nach.',
    'Sag Bescheid, wenn du tiefer einsteigen willst.',
    'Brauchst du noch was dazu?'
  ],

  recommendation: [
    'Wenn du mir sagst, was dir bei deinem Charakter wichtig ist (Kampf, Magie, Natur, Intrigen…), kann ich die Auswahl noch besser eingrenzen.',
    'Erzähl mir gerne, welchen Spielstil du magst – dann wird die Empfehlung schärfer.',
    'Falls du noch mehr Richtung brauchst, einfach nachhaken.'
  ]
};

function pick(arr) {
  return arr[
    Math.floor(Math.random() * arr.length)
  ];
}

function formatEntity(item) {
  if (!item) return null;

  const lines = [
    `**${item.name}**`
  ];

  if (item.emoji || item.icon) {
    lines[0] =
      `${item.emoji || item.icon} **${item.name}**`;
  }

  if (item.category) {
    lines.push(`*${item.category}*`);
  }

  if (item.domain) {
    lines.push(`*Domäne:* ${item.domain}`);
  }

  if (item.short) {
    lines.push(item.short);
  } else if (item.description) {
    lines.push(item.description);
  }

  if (item.strengths) {
    lines.push(
      `**Stärken:** ${item.strengths}`
    );
  }

  if (item.weaknesses) {
    lines.push(
      `**Schwächen:** ${item.weaknesses}`
    );
  }

  if (item.size) {
    lines.push(`Größe: ${item.size}`);
  }

  if (item.age) {
    lines.push(`Alter: ${item.age}`);
  }

  if (item.subraces?.length) {
    lines.push(
      `Unterarten: ${item.subraces.join(', ')}`
    );
  }

  return lines.join('\n');
}

async function responseFor(query) {
  const i = intent(query);
  const category = inferCategory(query);
  const qNorm = normalize(query);

  // === Spezielle Handler ===

  if (i.greeting) {
    return (
      pick(OPENINGS.greeting) +
      '\n\nIch kenne mich aus mit **Völkern**, **Berufen**, **Göttern**, **Kreaturen**, **Regeln** und dem Rest der Chroniken. Frag einfach.'
    );
  }

  if (i.help) {
    return `Ich bin der **Chronist** der Chroniken.

Du kannst mich z. B. fragen:
• Welche Völker / Berufe / Götter gibt es?
• Welcher Gott passt zu Natur?
• Was sind die Vorteile von X?
• Ich weiß nicht, welchen Beruf ich nehmen soll
• Welche Mods sind drauf?
• Wie ist das Wetter? / Welcher Mond steht?
• Was gilt für Magie? / Welche Magieschulen?
• Erzähl mir mehr über …

Einfach normal schreiben – ich verstehe auch Tippfehler und Umgangssprache.`;
  }

  if (i.mods) {
    const mods = await loadMods();

    return formatModsList(mods);
  }

  if (i.magic) {
    return formatMagicAnswer(query);
  }

  // Live-Wetter & Mond von der Proxy-API
  if (
    i.moon ||
    i.weatherNow ||
    category === 'wetter'
  ) {
    const live = await loadWeather();

    if (live) {
      const parts = [];

      if (i.moon && !i.weatherNow) {
        const moon = formatLiveMoon(live);

        if (moon) {
          parts.push(moon);

          if (
            /blutmond/.test(qNorm) &&
            live.moon &&
            !/blutmond/i.test(
              live.moon.name || ''
            )
          ) {
            parts.push(
              'Aktuell steht kein Blutmond – der Mond wechselt nach dem oben genannten Zeitpunkt.'
            );
          }
        }
      } else if (
        i.moon &&
        i.weatherNow
      ) {
        const w =
          formatLiveWeather(live);

        const m =
          formatLiveMoon(live);

        if (w) parts.push(w);
        if (m) parts.push(m);
      } else {
        const w =
          formatLiveWeather(live);

        if (w) parts.push(w);

        if (
          live.moon &&
          (
            i.current ||
            /aktuell|jetzt|gerade/.test(qNorm)
          )
        ) {
          const m =
            formatLiveMoon(live);

          if (m) parts.push(m);
        }
      }

      if (
        i.list &&
        knowledge.structured.wetter?.length
      ) {
        const names =
          knowledge.structured.wetter.map(x => {
            const ic =
              x.icon ||
              x.emoji ||
              '';

            return `• ${ic} ${x.name}`.trim();
          });

        parts.push(
          '**Mögliche Wetterlagen:**\n' +
          names.join('\n')
        );
      }

      if (parts.length) {
        return (
          parts.join('\n\n') +
          '\n\nSag Bescheid, wenn du mehr wissen willst.'
        );
      }
    }

    if (knowledge.structured.wetter?.length) {
      const names =
        knowledge.structured.wetter.map(x => {
          const ic =
            x.icon ||
            x.emoji ||
            '';

          const d =
            x.description
              ? ` – ${x.description}`
              : '';

          return `• ${ic} **${x.name}**${d}`.trim();
        });

      return `Aktuell keine Live-Wetterdaten – hier die bekannten Wetterlagen:

${names.join('\n')}

Sag Bescheid, wenn du mehr wissen willst.`;
    }
  }

  if (
    i.website ||
    (
      i.where &&
      /chronik|seite|web/.test(qNorm)
    )
  ) {
    return `Die zentrale Anlaufstelle ist die **Chroniken-Website**:
${SERVER_INFO.website}

Dort findest du Charakterbögen, Götter, Völker, Berufe, Wiki, Kalender und mehr.`;
  }

  // === Wissens-Antworten ===

  const hits = bestDocs(
    query,
    category
  );

  if (!hits.length && category) {
    const catDocs =
      knowledge.categories[
        normalize(category)
      ] || [];

    if (catDocs.length) {
      hits.push(
        ...catDocs
          .slice(0, 6)
          .map(d => ({
            d,
            s: 1
          }))
      );
    }
  }

  // Strukturierte Listen
  if (
    i.list ||
    i.count ||
    category === 'berufe'
  ) {
    if (
      category === 'berufe' &&
      knowledge.structured.berufe &&
      knowledge.structured.berufe.length
    ) {
      const q = normalize(query);

      let kind = null;

      if (
        /nebenberuf|neben beruf/.test(q)
      ) {
        kind = 'neben';
      } else if (
        /hauptberuf|haubtberuf|haupt beruf/.test(q)
      ) {
        kind = 'haupt';
      }

      const haupt =
        knowledge.structured.berufe.filter(
          b => /haupt/i.test(
            b.category || ''
          )
        );

      const neben =
        knowledge.structured.berufe.filter(
          b => /neben/i.test(
            b.category || ''
          )
        );

      const opening =
        pick(OPENINGS.list);

      if (kind === 'neben') {
        const list =
          neben
            .map(
              b =>
                `• **${b.name}** – ${b.description || ''}`
            )
            .join('\n');

        return `${opening}

**Nebenberufe (${neben.length}):**
${list}

Hauptberufe gibt es parallel – frag nach **Hauptberuf**, wenn du die sehen willst.`;
      }

      if (kind === 'haupt') {
        const list =
          haupt
            .map(
              b =>
                `• **${b.name}** – ${b.description || ''}`
            )
            .join('\n');

        return `${opening}

**Hauptberufe (${haupt.length}):**
${list}

Nebenberufe extra – frag nach **Nebenberuf**.`;
      }

      const h =
        haupt
          .map(
            b =>
              `• **${b.name}** – ${b.description || ''}`
          )
          .join('\n');

      const n =
        neben
          .map(
            b =>
              `• **${b.name}** – ${b.description || ''}`
          )
          .join('\n');

      return `${opening}

**Hauptberufe:**
${h}

**Nebenberufe:**
${n}`;
    }

    const names =
      findNames(category || '');

    if (names.length) {
      const catLabel = {
        berufe: 'Berufe',
        voelker: 'Völker',
        goetter: 'Götter',
        wetter: 'Wetterlagen'
      }[category] ||
        (
          category
            ? category[0].toUpperCase() +
              category.slice(1)
            : 'Einträge'
        );

      const opening =
        pick(OPENINGS.list);

      const list =
        names
          .slice(0, 30)
          .map(n => `• ${n}`)
          .join('\n');

      const more =
        names.length > 30
          ? `\n• … und ${names.length - 30} weitere`
          : '';

      const close =
        pick(CLOSINGS.default);

      if (i.count) {
        return `${opening}

Aktuell finde ich **${names.length}** ${catLabel}:

${list}${more}

${close}`;
      }

      return `${opening}

**${catLabel}:**
${list}${more}

${close}`;
    }
  }

  // Empfehlungen mit strukturierten Daten
  if (
    i.recommendation &&
    category
  ) {
    const list =
      knowledge.structured[
        category
      ] || [];

    if (list.length) {
      const keywords =
        queryEntityTokens(query)
          .filter(
            t =>
              !ALIASES[
                category
              ]?.includes(t)
          );

      let candidates = list;

      if (keywords.length) {
        candidates =
          list
            .map(item => {
              const hay =
                normalize(
                  [
                    item.name,
                    item.description,
                    item.strengths,
                    item.domain,
                    item.weaknesses
                  ]
                    .filter(Boolean)
                    .join(' ')
                );

              let s = 0;

              for (const k of keywords) {
                if (hay.includes(k)) {
                  s += 3;
                } else {
                  for (
                    const w of hay.split(/\s+/)
                  ) {
                    s +=
                      similarity(k, w) > 0.85
                        ? 1.5
                        : 0;
                  }
                }
              }

              return {
                item,
                s
              };
            })
            .filter(x => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map(x => x.item);

        if (!candidates.length) {
          candidates = list.slice(0, 4);
        }
      } else {
        candidates = list.slice(0, 5);
      }

      const shown =
        candidates.slice(0, 4);

      const parts =
        shown
          .map(formatEntity)
          .filter(Boolean);

      const opening =
        pick(OPENINGS.recommendation);

      const close =
        pick(CLOSINGS.recommendation);

      return `${opening}

${parts.join('\n\n')}

${close}`;
    }
  }

  // Detail / allgemeine Treffer – mit Konfidenz
  const conf =
    confidenceFromHits(
      hits,
      query
    );

  if (!hits.length || conf < 35) {
    if (
      looksRelevant(query) ||
      conf > 0
    ) {
      return `Dazu bin ich mir noch unsicher (Trefferquote ca. **${conf || 0}%**).

Versuch’s konkreter, z. B.:
• „Welche Berufe gibt es?“ / „Was ist der Hauptberuf X?“
• „Erzähl mir mehr über die Elfen“
• „Welcher Gott passt zu Natur?“

Oder schreib **Hilfe**.`;
    }

    return null;
  }

  const relevant =
    hits
      .slice(
        0,
        conf >= 60 ? 3 : 2
      )
      .map(x => x.d);

  const opening =
    i.recommendation
      ? pick(OPENINGS.recommendation)
      : pick(OPENINGS.default);

  const confLine =
    conf < 70
      ? `\n_Trefferquote: ca. **${conf}%** – wenn das nicht passt, formuliere die Frage gerne enger._`
      : '';

  const lines = [];

  for (const d of relevant) {
    if (
      isJunkText(d.text) ||
      isJunkText(d.title)
    ) {
      continue;
    }

    if (d.structured) {
      const formatted =
        formatEntity(d.structured);
      if (formatted) {
        lines.push(formatted);
        continue;
      }
    }

    const label =
      d.title &&
      d.title !== d.page
        ? `**${d.title}**`
        : `**${d.page}**`;

    let body =
      compact(d.text, 520);

    if (
      i.advantage ||
      i.disadvantage
    ) {
      const chunks =
        d.blocks.length
          ? d.blocks
          : [d.text];

      const wanted =
        chunks.filter(c => {
          const n = normalize(c);

          return i.advantage
            ? /(vorteil|bonus|staerke|stärke|gut|bringt|stärken)/.test(n)
            : /(nachteil|schwaeche|schwäche|problem|schlecht|schwächen)/.test(n);
        });

      if (wanted.length) {
        body =
          compact(
            wanted.join(' | '),
            520
          );
      }
    }

    if (
      /^(name|emoji|size|age|description|strengths|weaknesses)\s*:/.test(body)
    ) {
      body =
        body.replace(
          /\b(name|emoji|size|age|description|strengths|weaknesses)\s*:\s*/gi,
          ''
        );
    }

    lines.push(
      `${label}\n${body}`
    );
  }

  if (!lines.length) {
    return `Dazu habe ich nichts Sauberes in den Chroniken gefunden (Trefferquote ca. **${conf}%**).

Frag z. B. nach **Berufen**, **Völkern** oder **Göttern**.`;
  }

  const close =
    i.recommendation
      ? pick(CLOSINGS.recommendation)
      : pick(CLOSINGS.default);

  return `${opening}

${lines.join('\n\n')}${confLine}

${close}`;
}

// ===== MEMORY =====

function remember(
  channelId,
  author,
  content
) {
  if (!memory.has(channelId)) {
    memory.set(channelId, []);
  }

  const list =
    memory.get(channelId);

  list.push({
    author,
    content,
    ts: Date.now()
  });

  while (
    list.length > MEMORY_SIZE
  ) {
    list.shift();
  }

  // Alte Einträge entfernen
  const now = Date.now();

  memory.set(
    channelId,
    list.filter(
      x =>
        now - x.ts <= MEMORY_TTL
    )
  );
}

// ============================================================
// ===== EIGENES TICKET-SYSTEM =====
// ============================================================

function isTicketStaff(member) {
  if (!member || !member.roles?.cache) return false;
  return TICKET_STAFF_ROLE_IDS.some(id => member.roles.cache.has(id)) || isAdminMember(member);
}

function countUserTickets(userId) {
  let count = 0;
  for (const t of openTickets.values()) {
    if (t.userId === userId) count++;
  }
  return count;
}


function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle(ticketSettings.panelTitle || '🎫 Support – Ticket erstellen')
    .setDescription(ticketSettings.panelDescription || 'Wähle eine Kategorie.')
    .setColor(typeof ticketSettings.panelColor === 'number' ? ticketSettings.panelColor : 0xa855f7)
    .setFooter({ text: ticketSettings.panelFooter || 'Chroniken · Ticket-System' });
}

// tickets.bot style: buttons pro Kategorie (nicht nur Select)
function buildTicketPanelComponents() {
  const types = getTicketTypes();
  const rows = [];
  let row = new ActionRowBuilder();

  const styleMap = {
    1: ButtonStyle.Primary,
    2: ButtonStyle.Secondary,
    3: ButtonStyle.Success,
    4: ButtonStyle.Danger
  };

  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const btn = new ButtonBuilder()
      .setCustomId(`ticket_open_${t.id}`)
      .setLabel((t.label || t.id).slice(0, 80))
      .setStyle(styleMap[t.buttonStyle] || ButtonStyle.Primary);
    if (t.emoji) {
      try { btn.setEmoji(t.emoji); } catch {}
    }
    row.addComponents(btn);
    if (row.components.length === 5 || i === types.length - 1) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  }

  // Zusätzlich Select (wie Multi-Panel Dropdown-Option)
  if (types.length > 1) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket_create_select')
      .setPlaceholder('Oder Kategorie wählen…')
      .addOptions(
        types.slice(0, 25).map(t => {
          const opt = new StringSelectMenuOptionBuilder()
            .setLabel((t.label || t.id).slice(0, 100))
            .setDescription((t.description || '').slice(0, 100))
            .setValue(t.id);
          if (t.emoji) {
            try { opt.setEmoji(t.emoji); } catch {}
          }
          return opt;
        })
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows;
}

function buildTicketSelect() {
  // Rückwärtskompatibel: liefert erste Row-Komponenten-Liste
  return buildTicketPanelComponents();
}

function buildTicketControlRow(claimedBy = null) {
  const claimBtn = new ButtonBuilder()
    .setCustomId(claimedBy ? 'ticket_unclaim' : 'ticket_claim')
    .setLabel(claimedBy ? 'Freigeben (Unclaim)' : 'Übernehmen (Claim)')
    .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setEmoji(claimedBy ? '🔓' : '✋');

  const closeBtn = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Schließen')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const closeReasonBtn = new ButtonBuilder()
    .setCustomId('ticket_close_reason')
    .setLabel('Mit Grund schließen')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📝');

  const addUserBtn = new ButtonBuilder()
    .setCustomId('ticket_add_user')
    .setLabel('User +')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('➕');

  return new ActionRowBuilder().addComponents(claimBtn, closeBtn, closeReasonBtn, addUserBtn);
}


async function createTicketChannel(guild, user, typeId) {
  const types = getTicketTypes();
  const type = types.find(t => t.id === typeId) || types[0] || { id: 'support', label: 'Support', emoji: '🎫' };
  const catId = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketCategoryId) || TICKET_CATEGORY_ID;
  const category = catId ? await guild.channels.fetch(catId).catch(() => null) : null;

  const pattern = ticketSettings.namingPattern || 'ticket-{type}-{username}';
  const channelName = pattern
    .replace(/\{type\}/g, type.id)
    .replace(/\{username\}/g, user.username)
    .replace(/\{id\}/g, user.id.slice(-4))
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 90) || `ticket-${type.id}`;

  const staffRoleIds = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketStaffRoleIds?.length)
    ? runtimeSettings.ticketStaffRoleIds
    : TICKET_STAFF_ROLE_IDS;

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category?.id || undefined,
    permissionOverwrites: overwrites,
    topic: `Ticket von ${user.tag} (${user.id}) · ${type.label} · ${new Date().toLocaleString('de-DE')}`
  });

  const ticketData = {
    userId: user.id,
    type: type.id,
    typeLabel: type.label,
    claimedBy: null,
    createdAt: Date.now(),
    name: channel.name
  };
  openTickets.set(channel.id, ticketData);
  saveTickets();

  const welcomeRaw = ticketSettings.ticketWelcome || 'Hallo {mention}! Dein Ticket wurde erstellt.';
  const welcomeText = welcomeRaw
    .replace(/\{mention\}/g, `<@${user.id}>`)
    .replace(/\{name\}/g, user.username)
    .replace(/\{type\}/g, type.label)
    .replace(/\{channel\}/g, channel.name);

  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`${type.emoji || '🎫'} Ticket · ${type.label}`)
    .setDescription(welcomeText)
    .setColor(typeof ticketSettings.panelColor === 'number' ? ticketSettings.panelColor : 0xa855f7)
    .setFooter({ text: 'Claim · Schließen · Mit Grund schließen' })
    .setTimestamp();

  let ping = `<@${user.id}>`;
  if (ticketSettings.mentionStaffOnOpen && staffRoleIds.length) {
    ping += ' | ' + staffRoleIds.map(id => `<@&${id}>`).join(' ');
  }

  await channel.send({
    content: ping,
    embeds: [welcomeEmbed],
    components: [buildTicketControlRow()]
  });

  const logId = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketLogChannelId) || TICKET_LOG_CHANNEL_ID;
  if (logId) {
    const logCh = await guild.channels.fetch(logId).catch(() => null);
    if (logCh) {
      const logEmbed = new EmbedBuilder()
        .setTitle('🎫 Neues Ticket')
        .setColor(0x22c55e)
        .addFields(
          { name: 'User', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
          { name: 'Kategorie', value: type.label, inline: true },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true }
        )
        .setTimestamp();
      await logCh.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  return channel;
}

async function generateTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    let text = `=== TRANSCRIPT: ${channel.name} ===\n`;
    text += `Erstellt: ${new Date().toLocaleString('de-DE')}\n`;
    text += `Channel-ID: ${channel.id}\n\n`;

    for (const msg of sorted) {
      const time = msg.createdAt.toLocaleString('de-DE');
      const author = msg.author?.tag || 'Unbekannt';
      const content = msg.content || (msg.attachments.size ? '[Anhang]' : '[Embed/System]');
      text += `[${time}] ${author}: ${content}\n`;
      if (msg.attachments.size) {
        for (const att of msg.attachments.values()) {
          text += `  → ${att.url}\n`;
        }
      }
    }

    return text;
  } catch (e) {
    return `Transcript konnte nicht erstellt werden: ${e.message}`;
  }
}

async function closeTicket(channel, closer, reason = 'Geschlossen') {
  const ticket = openTickets.get(channel.id);
  if (!ticket) return false;

  // Transcript erstellen
  const transcript = await generateTranscript(channel);

  // Log senden
  if (TICKET_LOG_CHANNEL_ID) {
    const logCh = await channel.guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
    if (logCh) {
      const logEmbed = new EmbedBuilder()
        .setTitle('🔒 Ticket geschlossen')
        .setColor(0xef4444)
        .addFields(
          { name: 'Channel', value: channel.name, inline: true },
          { name: 'Ersteller', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Geschlossen von', value: `<@${closer.id}>`, inline: true },
          { name: 'Kategorie', value: ticket.typeLabel || ticket.type, inline: true },
          { name: 'Übernommen von', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
          { name: 'Grund', value: reason.slice(0, 200), inline: false }
        )
        .setTimestamp();

      await logCh.send({
        embeds: [logEmbed],
        files: [{
          attachment: Buffer.from(transcript, 'utf8'),
          name: `transcript-${channel.name}-${Date.now()}.txt`
        }]
      }).catch(() => {});
    }
  }

  openTickets.delete(channel.id);
  saveTickets();

  // Channel nach kurzer Verzögerung löschen
  await channel.send({ content: `🔒 Ticket wird in 5 Sekunden geschlossen… (von <@${closer.id}>)` }).catch(() => {});
  setTimeout(() => {
    channel.delete(`Ticket geschlossen von ${closer.tag}`).catch(() => {});
  }, 5000);

  return true;
}

// ============================================================
// ===== DISCORD CLIENT =====

// ============================================================
// ===== RATE-LIMIT-SCHUTZ (siehe Discord Rate Limits Doku) =====
// ============================================================

// Member-Cache mit TTL: verhindert wiederholte Voll-Fetches (Gateway Opcode 8: 120 / 60 s).
const MEMBER_CACHE_TTL_MS = 5 * 60 * 1000;
let membersFetchedAt = 0;
let membersFetchPromise = null;

async function ensureMembers(guild, force = false) {
  const fresh = Date.now() - membersFetchedAt < MEMBER_CACHE_TTL_MS;
  if (!force && fresh && guild.members.cache.size > 0) return guild.members.cache;
  if (membersFetchPromise) return membersFetchPromise; // parallele Aufrufe teilen sich einen Fetch
  membersFetchPromise = guild.members.fetch()
    .then(() => { membersFetchedAt = Date.now(); return guild.members.cache; })
    .catch(e => {
      console.warn('members.fetch fehlgeschlagen, nutze Cache:', e.message || e);
      return guild.members.cache;
    })
    .finally(() => { membersFetchPromise = null; });
  return membersFetchPromise;
}

// Kleiner Sleep + sicheres Senden mehrerer Nachrichten hintereinander
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Dashboard-API: einfaches Limit pro Route + IP (Fenster in ms)
const apiHits = new Map();
function apiRateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (apiHits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { apiHits.set(key, arr); return Math.ceil((windowMs - (now - arr[0])) / 1000); }
  arr.push(now);
  apiHits.set(key, arr);
  return 0;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of apiHits) {
    const f = arr.filter(t => now - t < 120000);
    if (f.length) apiHits.set(k, f); else apiHits.delete(k);
  }
}, 60000).unref();

// Globale Fehler-Handler: ein einzelner Discord-Fehler darf den Prozess nicht beenden
// (Crash-Schleifen => Identify-Limit + Invalid-Request-Bann durch Cloudflare).
process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
});
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});


// ============================================================

let presenceIndex = 0;
let lastNewsTitle = null;

function extractLatestNews() {
  const newsDocs =
    (
      knowledge.categories['news'] ||
      knowledge.categories['news'] ||
      []
    ).concat(
      knowledge.docs.filter(
        d =>
          /news|neuigkeit|ankuendigung|ankündigung/i.test(
            d.page + ' ' + d.title
          )
      )
    );

  for (const d of newsDocs) {
    const t =
      (d.title || '').trim();

    if (
      t &&
      t.length > 3 &&
      t.length < 80 &&
      !/^news|^chroniken|^die chroniken/i.test(t)
    ) {
      return t;
    }
  }

  for (const d of knowledge.docs) {
    if (
      /news/i.test(d.page) &&
      d.blocks?.length
    ) {
      const first =
        d.blocks[0].trim();

      if (
        first.length > 8 &&
        first.length < 90
      ) {
        return first.slice(0, 80);
      }
    }
  }

  return null;
}

async function updatePresence() {
  if (!client.isReady()) return;

  const mods =
    await loadMods().catch(
      () => modsCache.list || []
    );

  const modCount =
    mods.length;

  const news =
    extractLatestNews();

  if (news) {
    lastNewsTitle = news;
  }

  const live =
    await loadWeather().catch(
      () => null
    );

  const activities = [];

  if (
    live &&
    live.name
  ) {
    const icon =
      live.icon || '';

    activities.push({
      name:
        `${icon} ${live.name}`
          .trim()
          .slice(0, 100),

      type:
        ActivityType.Watching
    });
  }

  if (
    live &&
    live.moon &&
    live.moon.name
  ) {
    const icon =
      live.moon.icon ||
      '🌙';

    activities.push({
      name:
        `${icon} ${live.moon.name}`
          .trim()
          .slice(0, 100),

      type:
        ActivityType.Watching
    });
  }

  if (lastNewsTitle) {
    activities.push({
      name:
        lastNewsTitle.length > 100
          ? lastNewsTitle.slice(0, 97) + '…'
          : lastNewsTitle,

      type:
        ActivityType.Watching
    });
  }

  activities.push({
    name: 'Chroniken Website',
    type: ActivityType.Watching
  });

  if (modCount > 0) {
    activities.push({
      name:
        `${modCount} Conan-Mods aktiv`,

      type:
        ActivityType.Playing
    });
  }

  activities.push({
    name: 'den Chroniken',
    type: ActivityType.Listening
  });

  activities.push({
    name: 'Chroniken RP',
    type: ActivityType.Playing
  });

  if (!activities.length) {
    activities.push({
      name: 'Chroniken',
      type: ActivityType.Playing
    });
  }

  const activity =
    activities[
      presenceIndex %
      activities.length
    ];

  presenceIndex++;

  try {
    client.user.setPresence({
      activities: [activity],
      status: 'online'
    });

    console.log(
      `Presence: ${
        activity.type === ActivityType.Watching
          ? 'Watching'
          : activity.type === ActivityType.Listening
            ? 'Listening'
            : 'Playing'
      } ${activity.name}`
    );
  } catch (e) {
    console.warn(
      'Presence-Update fehlgeschlagen:',
      e.message
    );
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ],

  partials: [
    Partials.Channel
  ]
});

// ----- Fehler- und Rate-Limit-Logging -----
client.on('error', e => console.error('[client error]', e && e.message || e));
client.on('warn', m => console.warn('[client warn]', m));
client.on('shardError', e => console.error('[shard error]', e && e.message || e));
client.on('shardDisconnect', (ev, id) => console.warn(`[shard ${id}] getrennt (Code ${ev && ev.code})`));
client.on('shardReconnecting', id => console.log(`[shard ${id}] verbindet neu…`));
client.on('invalidated', () => {
  console.error('Discord-Session ungültig (z. B. Token zurückgesetzt) – keine weiteren Login-Versuche.');
});
client.rest.on('rateLimited', info => {
  console.warn(
    `[RateLimit] ${info.method} ${info.route || info.url} – Limit ${info.limit}, ` +
    `warte ${info.timeToReset ?? info.retryAfter}ms${info.global ? ' (GLOBAL)' : ''} scope=${info.scope || '?'}`
  );
});
client.rest.on('invalidRequestWarning', w => {
  console.error(`[InvalidRequests] ${w.count} ungültige Requests (401/403/429), Reset in ${w.remainingTime}ms – Cloudflare-Bann ab 10.000/10min!`);
});

client.once(
  'ready',
  async () => {
    console.log(
      `Online als ${client.user.tag}`
    );

    try {
      client.user.setPresence({
        activities: [
          {
            name: 'Chroniken startet…',
            type: ActivityType.Playing
          }
        ],
        status: 'online'
      });
    } catch {}

    // Rollen-Diagnose beim Start: zeigt sofort, ob „Heiler“/„Bibliothek“ vergeben werden können
    try {
      const g = GUILD_ID ? client.guilds.cache.get(GUILD_ID) : null;
      if (g) {
        for (const [label, id] of [['Heiler', HEALER_ROLE_ID], ['Bibliothek', LIB_ROLE_ID]]) {
          if (!id) continue;
          const r = g.roles.cache.get(id);
          if (!r) { console.warn(`[Rollen-Check] „${label}“ (${id}) existiert nicht auf dem Server.`); continue; }
          const pr = roleProblem(g, r, null);
          console.log(pr ? `[Rollen-Check] ⚠️ „${label}“: ${pr}` : `[Rollen-Check] ✅ „${label}“ kann vergeben werden.`);
        }
      }
    } catch (e) { console.warn('Rollen-Check fehlgeschlagen:', e.message); }

    await registerCommands();
    await refreshKnowledge();
    await updatePresence();

    setInterval(
      refreshKnowledge,
      3 * 60 * 1000
    );

    setInterval(
      updatePresence,
      2 * 60 * 1000
    );
  }
);


// ============================================================
// /char <ID> – Charakter-Infos für Admins
// ============================================================

const MONTHS_DE = ['Frostmond','Eismond','Tauwind','Blütenmond','Sonnenhain','Glutmond','Erntemond','Goldlaub','Nebelmond','Dunkelmond','Sternenfall','Nachtfrost'];

async function loadCharData() {
  const data = await fetchChronikenData();

  if (!data) throw new Error('Datenbank nicht erreichbar.');

  return {
    characters: Array.isArray(data.characters) ? data.characters : [],
    sheets: Array.isArray(data.character_sheets) ? data.character_sheets : []
  };
}

function normalizeCharId(input) {
  const raw = String(input || '').trim().toUpperCase();
  const m = /^(?:CH-?)?(\d{1,6})$/.exec(raw);

  return m ? 'CH-' + m[1].padStart(4, '0') : raw;
}

function findCharacter(characters, input) {
  const id = normalizeCharId(input);

  let c = characters.find(x => String(x.id || '').toUpperCase() === id);

  if (c) return c;

  // Fallback: Charaktername
  const n = normalize(input);

  return characters.find(x => normalize(x.name || '') === n) || null;
}

function isAdminMember(member) {
  if (!member || !member.roles || !member.roles.cache) return false;

  return ADMIN_ROLE_IDS.some(id => member.roles.cache.has(id));
}

function field(name, value, inline = true) {
  const v = String(value == null || value === '' ? '—' : value).slice(0, 1020);

  return { name, value: v, inline };
}

function sheetBirthday(d) {
  if (!d) return '';

  const day = d.birthdayDay || '';
  const month = d.birthdayMonth !== undefined && d.birthdayMonth !== ''
    ? (MONTHS_DE[Number(d.birthdayMonth)] || '')
    : '';

  return [day ? day + '.' : '', month, d.birthdayYear || ''].filter(Boolean).join(' ');
}

function buildCharEmbed(c, sheet) {
  const d = sheet ? (sheet.data || sheet.characterData || {}) : {};
  const warnings = Number(c.warnings) || 0;

  const violations = Array.isArray(c.violationTexts) && c.violationTexts.length
    ? c.violationTexts
    : (Array.isArray(c.violationDetails) ? c.violationDetails.map(x => String(x).replace(/^[A-Z0-9-]+\s*·\s*/, '')) : []);

  const roles = [
    c.heiler ? '🩺 Heiler' : '',
    c.bibliothek ? '📚 Bibliothek' : ''
  ].filter(Boolean).join(', ');

  const wishes = [
    c.wantsHeiler && !c.heiler ? '🩺 Heiler' : '',
    c.wantsBibliothek && !c.bibliothek ? '📚 Buchschreiber' : ''
  ].filter(Boolean).join(', ');

  const jobs = [d.mainJob || c.mainJob, d.subJob || c.subJob].filter(Boolean).join(' / ');
  const subraces = Array.isArray(d.subraces) ? d.subraces.join(', ') : '';
  const magic = Array.isArray(d.magicSchools) ? d.magicSchools.join(', ') : '';

  const color = warnings >= 3 ? 0xe11d48 : warnings > 0 ? 0xf59e0b : 0xa855f7;

  const embed = new EmbedBuilder()
    .setTitle(`📜 ${c.name || 'Unbenannt'} · ${c.id}`)
    .setColor(color)
    .addFields(
      field('Spieler', c.player || d.discordName),
      field('Discord', c.discordName || d.discordName),
      field('Steam-ID', c.steamId || d.steamId),
      field('Volk', (c.race || d.race || '—') + (subraces ? ' (' + subraces + ')' : '')),
      field('Status', c.status || 'aktiv'),
      field('Verwarnungen', warnings),
      field('Geschlecht / Alter', [d.gender || c.gender, d.age || c.age].filter(Boolean).join(' · ')),
      field('Größe', d.size || c.size),
      field('Gott', d.god || c.god),
      field('Berufe', jobs),
      field('Geburtstag', sheetBirthday(d) || sheetBirthday(c)),
      field('Magie', magic),
      field('Discord-Rollen', roles || 'keine'),
      field('Rollenwunsch (offen)', wishes || '—')
    );

  if (violations.length) {
    embed.addFields(field('⚠️ Regelverstöße', violations.map(v => '• ' + v).join('\n'), false));
  }

  if (c.notes) {
    embed.addFields(field('📝 Admin-Notizen', c.notes, false));
  }

  if (!sheet) {
    embed.addFields(field('Charakterbogen', 'Keine Bogen-Kopie gespeichert.', false));
  } else if (d.background) {
    embed.addFields(field('Hintergrund', compact(d.background, 900), false));
  }

  const dates = [];

  if (c.createdAt) dates.push('Angelegt: ' + (formatDateDe(c.createdAt) || c.createdAt));
  if (c.updatedAt) dates.push('Geändert: ' + (formatDateDe(c.updatedAt) || c.updatedAt));

  embed.setFooter({ text: ('Chroniken · Admin-Info' + (dates.length ? ' · ' + dates.join(' · ') : '')).slice(0, 2000) });

  return embed;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('char')
      .setDescription('Zeigt alle Infos zu einem Charakter (nur Admins)')
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Charakter-ID, z. B. CH-0012 (oder Name)')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('ticket-panel')
      .setDescription('Postet das Ticket-Panel in diesen Channel (nur Team)')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('ticket-close')
      .setDescription('Schließt das aktuelle Ticket (nur im Ticket-Channel)')
      .addStringOption(o =>
        o.setName('grund')
          .setDescription('Optionaler Schließgrund')
          .setRequired(false)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('roles-panel')
      .setDescription('Postet schöne Button-Rollen-Panels (nur Admins)')
      .toJSON()
  ];

  try {
    // Nur registrieren, wenn sich die Definitionen geändert haben (Limit: ~200 Command-Erstellungen/Tag).
    const hashFile = path.join(__dirname, 'commands-hash.json');
    const hash = require('crypto').createHash('sha256').update(JSON.stringify({ g: GUILD_ID, commands })).digest('hex');
    let oldHash = '';
    try { oldHash = JSON.parse(fs.readFileSync(hashFile, 'utf8')).hash || ''; } catch {}
    const guild = GUILD_ID ? client.guilds.cache.get(GUILD_ID) : null;

    if (oldHash === hash) {
      // Hash allein reicht nicht: nach Kick/Neu-Einladung löscht Discord die Befehle.
      // Ein einzelner GET prüft, ob sie wirklich noch registriert sind.
      try {
        const existing = guild ? await guild.commands.fetch() : await client.application.commands.fetch();
        const have = new Set([...existing.values()].map(c => c.name));
        if (commands.every(c => have.has(c.name))) {
          console.log('Slash-Commands unverändert und bei Discord vorhanden – Registrierung übersprungen.');
          return;
        }
        console.log('Slash-Commands fehlen bei Discord – registriere neu.');
      } catch (e) {
        console.warn('Slash-Command-Check fehlgeschlagen, registriere sicherheitshalber neu:', e.message);
      }
    }

    if (guild) {
      await guild.commands.set(commands);
    } else {
      await client.application.commands.set(commands);
    }

    try { fs.writeFileSync(hashFile, JSON.stringify({ hash })); } catch {}
    console.log('Slash-Commands registriert: /char, /ticket-panel, /ticket-close, /roles-panel');
  } catch (e) {
    console.error('Slash-Commands konnten nicht registriert werden:', e.message);
  }
}

client.on('interactionCreate', async interaction => {
  try {
    if (GUILD_ID && interaction.guildId !== GUILD_ID) return;

    // ---------- Autocomplete /char ----------
    if (interaction.isAutocomplete() && interaction.commandName === 'char') {
      if (!isAdminMember(interaction.member)) return interaction.respond([]);

      const typed = String(interaction.options.getFocused() || '').toLowerCase();
      const { characters } = await loadCharData();

      const choices = characters
        .filter(c => (String(c.id || '') + ' ' + String(c.name || '')).toLowerCase().includes(typed))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(0, 25)
        .map(c => ({
          name: `${c.id} · ${c.name || '?'}`.slice(0, 100),
          value: String(c.id).slice(0, 100)
        }));

      return interaction.respond(choices);
    }

    // ---------- Select Menu: Ticket erstellen ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_create_select') {
      await interaction.deferReply({ ephemeral: true });

      const typeId = interaction.values[0];
      const user = interaction.user;

      const limit = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketLimitPerUser) || TICKET_LIMIT_PER_USER;
      if (countUserTickets(user.id) >= limit) {
        return interaction.editReply({
          content: `❌ Du hast bereits **${limit}** offene Tickets. Schließe erst eines, bevor du ein neues erstellst.`
        });
      }

      const catCheck = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketCategoryId) || TICKET_CATEGORY_ID;
      if (!catCheck) {
        return interaction.editReply({
          content: '⚠️ Ticket-Kategorie ist noch nicht konfiguriert. Trage sie im Dashboard oder in der config.env ein.'
        });
      }

      try {
        const channel = await createTicketChannel(interaction.guild, user, typeId);
        return interaction.editReply({
          content: `✅ Dein Ticket wurde erstellt: <#${channel.id}>`
        });
      } catch (err) {
        console.error('Ticket erstellen fehlgeschlagen:', err);
        return interaction.editReply({
          content: `❌ Ticket konnte nicht erstellt werden: ${err.message}`
        });
      }
    }

    // ---------- Buttons ----------
    if (interaction.isButton()) {
      // --- Ticket öffnen (Panel-Buttons wie tickets.bot) ---
      if (interaction.customId.startsWith('ticket_open_')) {
        await interaction.deferReply({ ephemeral: true });
        const typeId = interaction.customId.replace('ticket_open_', '');
        const user = interaction.user;
        const limit = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketLimitPerUser) || TICKET_LIMIT_PER_USER;
        if (countUserTickets(user.id) >= limit) {
          return interaction.editReply({
            content: `❌ Du hast bereits **${limit}** offene Tickets.`
          });
        }
        const catCheck = (typeof runtimeSettings !== 'undefined' && runtimeSettings.ticketCategoryId) || TICKET_CATEGORY_ID;
        if (!catCheck) {
          return interaction.editReply({
            content: '⚠️ Ticket-Kategorie nicht konfiguriert (Dashboard → Einstellungen).'
          });
        }
        try {
          const channel = await createTicketChannel(interaction.guild, user, typeId);
          return interaction.editReply({ content: `✅ Ticket erstellt: <#${channel.id}>` });
        } catch (err) {
          console.error('Ticket open:', err);
          return interaction.editReply({ content: `❌ ${err.message}` });
        }
      }

      const ticket = openTickets.get(interaction.channelId);

      // Claim
      if (interaction.customId === 'ticket_claim') {
        if (!ticket) {
          return interaction.reply({ content: 'Dieses Ticket ist nicht mehr aktiv.', ephemeral: true });
        }
        if (!isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Nur Team-Mitglieder können Tickets übernehmen.', ephemeral: true });
        }
        if (ticket.claimedBy) {
          return interaction.reply({ content: `Dieses Ticket wurde bereits von <@${ticket.claimedBy}> übernommen.`, ephemeral: true });
        }

        ticket.claimedBy = interaction.user.id;
        openTickets.set(interaction.channelId, ticket);
        saveTickets();

        await interaction.update({
          components: [buildTicketControlRow(ticket.claimedBy)]
        });

        return interaction.followUp({
          content: `✋ **${interaction.user.username}** hat das Ticket übernommen.`
        });
      }

      // Unclaim
      if (interaction.customId === 'ticket_unclaim') {
        if (!ticket) {
          return interaction.reply({ content: 'Dieses Ticket ist nicht mehr aktiv.', ephemeral: true });
        }
        if (!isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Nur Team-Mitglieder.', ephemeral: true });
        }
        if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !isAdminMember(interaction.member)) {
          return interaction.reply({ content: '⛔ Nur der Claimer oder Admins können freigeben.', ephemeral: true });
        }
        ticket.claimedBy = null;
        openTickets.set(interaction.channelId, ticket);
        saveTickets();
        await interaction.update({ components: [buildTicketControlRow(null)] });
        return interaction.followUp({ content: `🔓 **${interaction.user.username}** hat das Ticket freigegeben.` });
      }

      // Close with reason (Modal)
      if (interaction.customId === 'ticket_close_reason') {
        if (!ticket) {
          return interaction.reply({ content: 'Dieses Ticket ist nicht mehr aktiv.', ephemeral: true });
        }
        const isOwner = ticket.userId === interaction.user.id;
        if (!isOwner && !isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Keine Berechtigung.', ephemeral: true });
        }
        const modal = new ModalBuilder()
          .setCustomId('ticket_close_reason_modal')
          .setTitle('Ticket schließen');
        const input = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Schließgrund')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('z.B. Erledigt, Spam, Duplikat…')
          .setRequired(true)
          .setMaxLength(500);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // Close
      if (interaction.customId === 'ticket_close') {
        if (!ticket) {
          return interaction.reply({ content: 'Dieses Ticket ist nicht mehr aktiv.', ephemeral: true });
        }
        const isOwner = ticket.userId === interaction.user.id;
        if (!isOwner && !isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Nur der Ersteller oder das Team kann das Ticket schließen.', ephemeral: true });
        }

        await interaction.reply({ content: 'Ticket wird geschlossen…', ephemeral: true });
        await closeTicket(interaction.channel, interaction.user, 'Über Button geschlossen');
        return;
      }

      // User hinzufügen
      if (interaction.customId === 'ticket_add_user') {
        if (!ticket || !isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Nur Team-Mitglieder können User hinzufügen.', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('ticket_add_user_modal')
          .setTitle('User zum Ticket hinzufügen');

        const input = new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('Discord User-ID oder @Mention')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('z.B. 123456789012345678')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // User entfernen
      if (interaction.customId === 'ticket_remove_user') {
        if (!ticket || !isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Nur Team-Mitglieder können User entfernen.', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('ticket_remove_user_modal')
          .setTitle('User aus Ticket entfernen');

        const input = new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('Discord User-ID oder @Mention')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // ---------- Button-Rollen (Self-Roles) ----------
      if (interaction.customId.startsWith('role_toggle_')) {
        await interaction.deferReply({ ephemeral: true });
        const roleId = interaction.customId.replace('role_toggle_', '');
        const member = interaction.member;
        const role = interaction.guild.roles.cache.get(roleId);

        if (!role) {
          return interaction.editReply({ content: '❌ Diese Rolle existiert nicht mehr.' });
        }

        const problem = roleProblem(interaction.guild, role, member);
        if (problem) {
          return interaction.editReply({ content: '❌ Rolle konnte nicht gesetzt werden: ' + problem });
        }

        try {
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId);
            return interaction.editReply({ content: `❎ Rolle **${role.name}** entfernt.` });
          } else {
            await member.roles.add(roleId);
            return interaction.editReply({ content: `✅ Rolle **${role.name}** erhalten.` });
          }
        } catch (err) {
          return interaction.editReply({
            content: `❌ Rolle konnte nicht gesetzt werden: ${err.message}\n(Bot braucht „Rollen verwalten“ und muss über der Rolle stehen.)`
          });
        }
      }
    }

    // ---------- Modals ----------
    if (interaction.isModalSubmit()) {
      const ticket = openTickets.get(interaction.channelId);

      if (interaction.customId === 'ticket_close_reason_modal') {
        if (!ticket) {
          return interaction.reply({ content: 'Ticket nicht aktiv.', ephemeral: true });
        }
        const reason = interaction.fields.getTextInputValue('reason') || 'Kein Grund';
        await interaction.reply({ content: 'Ticket wird geschlossen…', ephemeral: true });
        await closeTicket(interaction.channel, interaction.user, reason);
        return;
      }

      if (interaction.customId === 'ticket_add_user_modal' || interaction.customId === 'ticket_remove_user_modal') {
        if (!ticket || !isTicketStaff(interaction.member)) {
          return interaction.reply({ content: '⛔ Keine Berechtigung.', ephemeral: true });
        }

        let raw = interaction.fields.getTextInputValue('user_id').trim();
        const mentionMatch = raw.match(/^<@!?(\\d+)>$/);
        if (mentionMatch) raw = mentionMatch[1];

        const targetId = raw.replace(/\\D/g, '');
        if (!targetId || targetId.length < 15) {
          return interaction.reply({ content: '❌ Ungültige User-ID.', ephemeral: true });
        }

        try {
          const member = await interaction.guild.members.fetch(targetId);

          if (interaction.customId === 'ticket_add_user_modal') {
            await interaction.channel.permissionOverwrites.edit(member.id, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              AttachFiles: true
            });
            return interaction.reply({ content: `✅ <@${member.id}> wurde zum Ticket hinzugefügt.` });
          } else {
            await interaction.channel.permissionOverwrites.delete(member.id);
            return interaction.reply({ content: `✅ <@${member.id}> wurde aus dem Ticket entfernt.` });
          }
        } catch (err) {
          return interaction.reply({ content: `❌ Fehler: ${err.message}`, ephemeral: true });
        }
      }
    }

    // ---------- Slash-Commands ----------
    if (!interaction.isChatInputCommand()) return;

    // /ticket-panel
    if (interaction.commandName === 'ticket-panel') {
      if (!isTicketStaff(interaction.member) && !isAdminMember(interaction.member)) {
        return interaction.reply({ content: '⛔ Nur Team-Mitglieder können das Panel posten.', ephemeral: true });
      }

      await interaction.reply({
        embeds: [buildTicketPanelEmbed()],
        components: buildTicketPanelComponents()
      });
      return;
    }

    // /ticket-close
    if (interaction.commandName === 'ticket-close') {
      const ticket = openTickets.get(interaction.channelId);
      if (!ticket) {
        return interaction.reply({ content: '❌ Dies ist kein aktives Ticket.', ephemeral: true });
      }

      const isOwner = ticket.userId === interaction.user.id;
      if (!isOwner && !isTicketStaff(interaction.member)) {
        return interaction.reply({ content: '⛔ Keine Berechtigung.', ephemeral: true });
      }

      const grund = interaction.options.getString('grund') || 'Über Befehl geschlossen';
      await interaction.reply({ content: 'Ticket wird geschlossen…', ephemeral: true });
      await closeTicket(interaction.channel, interaction.user, grund);
      return;
    }


    // /roles-panel
    if (interaction.commandName === 'roles-panel') {
      if (!isAdminMember(interaction.member)) {
        return interaction.reply({ content: '⛔ Nur Admins können das Rollen-Panel posten.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const panels = (savedRolePanels && savedRolePanels.length) ? savedRolePanels : [];

      if (!panels.length || !panels.some(p => p.roles && p.roles.length)) {
        return interaction.editReply({
          content: '⚠️ Noch keine Rollen-Panels gespeichert. Lege sie im **Dashboard** unter „Rollen-Panels“ an und speichere sie.'
        });
      }

      for (const panel of panels) {
        if (!panel.roles || !panel.roles.length) continue;

        const embed = new EmbedBuilder()
          .setTitle(panel.title || 'Rollen')
          .setDescription(panel.description || 'Klicke auf die Buttons, um Rollen zu erhalten oder zu entfernen.')
          .setColor(panel.color || 0xa855f7)
          .setFooter({ text: 'Klicke auf die Buttons · Chroniken' });

        const rows = [];
        let currentRow = new ActionRowBuilder();

        for (let i = 0; i < panel.roles.length; i++) {
          const r = panel.roles[i];
          const btn = new ButtonBuilder()
            .setCustomId(`role_toggle_${r.id}`)
            .setLabel(r.label || 'Rolle')
            .setStyle(ButtonStyle.Secondary);
          if (r.emoji) btn.setEmoji(r.emoji);

          currentRow.addComponents(btn);

          if (currentRow.components.length === 5 || i === panel.roles.length - 1) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
          }
        }

        await interaction.channel.send({ embeds: [embed], components: rows });
        await sleep(400);
      }

      return interaction.editReply({ content: '✅ Rollen-Panel(s) wurden gepostet.' });
    }

    // /char
    if (interaction.commandName === 'char') {
      if (!isAdminMember(interaction.member)) {
        return interaction.reply({
          content: '⛔ Dieser Befehl ist nur für das Team (berechtigte Rollen).',
          flags: 64
        });
      }

      await interaction.deferReply();

      const input = interaction.options.getString('id', true);
      const { characters, sheets } = await loadCharData();
      const c = findCharacter(characters, input);

      if (!c) {
        return interaction.editReply(`❌ Kein Charakter mit der ID/dem Namen **${input}** gefunden.`);
      }

      const sheet = sheets.find(x => String(x && x.id || '') === String(c.id)) || null;
      const embed = buildCharEmbed(c, sheet);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('In der Charakterverwaltung öffnen')
          .setStyle(ButtonStyle.Link)
          .setURL(SITE + 'admin/charaktere.html')
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

  } catch (e) {
    console.error('Interaction Fehler:', e);

    try {
      const msg = '❌ Fehler: ' + (e.message || 'unbekannt');
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else if (interaction.isRepliable()) await interaction.reply({ content: msg, flags: 64 });
    } catch {}
  }
});

client.on(
  'messageCreate',
  async message => {
    if (message.author.bot) return;

    // Nur der eingestellte Discord-Server
    if (
      GUILD_ID &&
      message.guildId !== GUILD_ID
    ) {
      return;
    }

    // ===== WICHTIG =====
    // Der Bot reagiert ausschließlich
    // in diesem einen Channel.
    if (
      !CHANNEL_ID ||
      message.channelId !== CHANNEL_ID
    ) {
      return;
    }

    const content =
      message.content.trim();

    if (
      !content ||
      content.length > 900
    ) {
      return;
    }

    remember(
      message.channel.id,
      message.author.username,
      content
    );

    const mentioned =
      message.mentions.has(client.user);

    const isQuestion =
      /\?/.test(content) ||
      looksRelevant(content);

    if (
      !mentioned &&
      !isQuestion
    ) {
      return;
    }

    try {
      if (!knowledge.updated) {
        await refreshKnowledge();
      }

      let answer =
        await responseFor(content);

      if (!answer && mentioned) {
        answer =
          'Ich bin der Chronist der Chroniken. Frag mich zu **Völkern**, **Berufen**, **Göttern**, **Regeln** oder einfach „Hilfe“.';
      }

      if (!answer) return;

      const chunks = [];
      let remaining = answer;

      while (
        remaining.length > 0
      ) {
        if (
          remaining.length <= 1900
        ) {
          chunks.push(remaining);
          break;
        }

        let cut =
          remaining.lastIndexOf(
            '\n',
            1900
          );

        if (cut < 800) {
          cut = 1900;
        }

        chunks.push(
          remaining.slice(0, cut)
        );

        remaining =
          remaining
            .slice(cut)
            .trimStart();
      }

      for (
        let i = 0;
        i < chunks.length;
        i++
      ) {
        if (i === 0) {
          await message.reply({
            content: chunks[i],

            allowedMentions: {
              repliedUser: false
            }
          });
        } else {
          await message.channel.send(
            chunks[i]
          );
        }
      }
    } catch (e) {
      console.error(
        'Antwortfehler:',
        e
      );
    }
  }
);

// ============================================================
// CHRONIKEN TEAM API
// ============================================================

function teamMemberData(member) {
  return {
    id: member.id,
    name:
      member.user?.username ||
      member.displayName ||
      'Unbekannt',
    displayName:
      member.displayName ||
      member.user?.globalName ||
      member.user?.username ||
      'Unbekannt',
    avatar: member.displayAvatarURL({
      extension: 'png',
      size: 128
    }),
    status:
      member.presence?.status ||
      'offline',
    roles: member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(role => role.name)
  };
}

async function getTeamMembers() {
  if (!GUILD_ID) {
    throw new Error('DISCORD_GUILD_ID fehlt.');
  }

  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    throw new Error(
      `Discord-Server ${GUILD_ID} wurde nicht gefunden.`
    );
  }

  await ensureMembers(guild);

  return [...guild.members.cache.values()]
    .filter(member => !member.user.bot)
    .map(teamMemberData)
    .sort((a, b) =>
      a.displayName.localeCompare(
        b.displayName,
        'de',
        { sensitivity: 'base' }
      )
    );
}

function sendTeamJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });

  res.end(body);
}

// ----- Discord-Rollen (Heiler / Bibliothek) für die Charakterverwaltung -----

function cleanDiscordName(v) {
  return String(v || '')
    .trim()
    .replace(/^@/, '')
    .replace(/#0$|#\d{4}$/, '')
    .toLowerCase();
}

async function findMemberByName(guild, rawName) {
  const wanted = cleanDiscordName(rawName);

  if (!wanted) return null;

  await ensureMembers(guild);

  const matches = guild.members.cache.filter(m => {
    if (m.user.bot) return false;

    return [
      m.user.username,
      m.user.globalName,
      m.displayName,
      m.nickname
    ].some(n => cleanDiscordName(n) === wanted);
  });

  if (matches.size === 1) return matches.first();

  if (matches.size > 1) {
    // Bei Mehrdeutigkeit den exakten Benutzernamen bevorzugen
    const exact = matches.filter(m => cleanDiscordName(m.user.username) === wanted);

    if (exact.size === 1) return exact.first();

    const err = new Error('Mehrere Discord-Mitglieder passen auf „' + rawName + '“. Bitte den genauen Benutzernamen eintragen.');
    err.status = 409;
    throw err;
  }

  return null;
}

// Prüft VOR dem API-Call, ob der Bot die Rolle vergeben darf. Verhindert 403-Fehler
// (zählen zum Invalid-Request-Limit) und liefert eine konkrete Fehlerbeschreibung.
function roleProblem(guild, role, member) {
  const me = guild.members.me;
  if (!me) return 'Bot-Mitglied im Server nicht gefunden.';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return `Dem Bot fehlt die Berechtigung „Rollen verwalten“. (Server-Einstellungen → Rollen → Bot-Rolle „${me.roles.highest.name}“ → „Rollen verwalten“ aktivieren)`;
  }
  if (role.managed) {
    return `„${role.name}“ ist eine verwaltete Rolle (Integration/Bot) und kann nicht vergeben werden.`;
  }
  if (role.id === guild.id) return 'Die @everyone-Rolle kann nicht vergeben werden.';
  if (role.position >= me.roles.highest.position) {
    return `Die Bot-Rolle „${me.roles.highest.name}“ (Pos. ${me.roles.highest.position}) steht nicht über „${role.name}“ (Pos. ${role.position}). ` +
      'Server-Einstellungen → Rollen → Bot-Rolle per Drag & Drop über diese Rolle ziehen.';
  }
  if (member && member.id !== guild.ownerId && member.roles.highest.position >= me.roles.highest.position) {
    return `„${member.user.username}“ hat eine Rolle, die gleich hoch oder höher als die Bot-Rolle ist – der Bot darf dieses Mitglied nicht ändern.`;
  }
  return null;
}

async function syncRoles(body) {
  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    const err = new Error('Discord-Server wurde nicht gefunden.');
    err.status = 500;
    throw err;
  }

  const username = String(body.username || '').trim();
  const member = await findMemberByName(guild, username);

  if (!member) {
    const err = new Error('Discord-Mitglied „' + username + '“ wurde nicht gefunden. Stimmt der Discord-Name?');
    err.status = 404;
    err.code = 'MEMBER_NOT_FOUND';
    throw err;
  }

  const wanted = [
    ['Heiler', HEALER_ROLE_ID, body.heiler === true],
    ['Bibliothek', LIB_ROLE_ID, body.bibliothek === true]
  ];

  const added = [];
  const removed = [];

  for (const [label, roleId, shouldHave] of wanted) {
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      const err = new Error('Discord-Rolle „' + label + '“ (' + roleId + ') existiert nicht.');
      err.status = 500;
      throw err;
    }

    const has = member.roles.cache.has(roleId);

    if ((shouldHave && !has) || (!shouldHave && has)) {
      const problem = roleProblem(guild, role, member);
      if (problem) {
        const err = new Error('Rolle „' + label + '“ konnte nicht gesetzt werden: ' + problem);
        err.status = 500;
        err.code = 'ROLE_NOT_MANAGEABLE';
        throw err;
      }
    }

    try {
      if (shouldHave && !has) {
        await member.roles.add(role, 'Chroniken Charakterverwaltung');
        added.push(label);
      } else if (!shouldHave && has) {
        await member.roles.remove(role, 'Chroniken Charakterverwaltung');
        removed.push(label);
      }
    } catch (e) {
      const err = new Error('Rolle „' + label + '“ konnte nicht gesetzt werden: ' + e.message + ' (Bot braucht „Rollen verwalten“ und muss über der Rolle stehen.)');
      err.status = 500;
      throw err;
    }
  }

  return {
    ok: true,
    member: member.user.username,
    added,
    removed
  };
}

async function readJsonBody(req, max = 20000) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > max) {
      const err = new Error('Daten zu groß.');
      err.status = 413;
      throw err;
    }
  }

  try {
    return JSON.parse(raw || '{}');
  } catch {
    const err = new Error('Ungültiges JSON.');
    err.status = 400;
    throw err;
  }
}

// ============================================================
// DASHBOARD + TEAM API (HTTP)
// ============================================================

const DASHBOARD_DIR = path.join(__dirname, 'dashboard');

// Runtime-Settings (können über Dashboard geändert werden)
const runtimeSettings = {
  ticketCategoryId: TICKET_CATEGORY_ID,
  ticketLogChannelId: TICKET_LOG_CHANNEL_ID,
  ticketLimitPerUser: TICKET_LIMIT_PER_USER,
  ticketStaffRoleIds: [...TICKET_STAFF_ROLE_IDS]
};

function applyRuntimeSettings() {
  // Werte zurück in die Modul-Variablen spiegeln
  if (runtimeSettings.ticketCategoryId) {
    // TICKET_CATEGORY_ID ist const – wir nutzen runtimeSettings in den Ticket-Funktionen
  }
}

function sendHtml(res, status, html) {
  const body = html;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn('Dashboard-Datei fehlt:', filePath);
      const msg = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
        <h1>Dashboard-Datei nicht gefunden</h1>
        <p>Gesucht: <code>${filePath}</code></p>
        <p>Lege den Ordner <strong>dashboard/</strong> neben die <code>index.js</code> (mit index.html, style.css, app.js).</p>
        <p>Aktueller __dirname: <code>${__dirname}</code></p>
      </body></html>`;
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(msg);
      return;
    }
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch (e) {
    console.warn('sendFile Fehler:', e.message);
    sendTeamJson(res, 404, { ok: false, error: 'NOT_FOUND', detail: e.message });
  }
}

function checkApiAuth(req) {
  if (!BOT_API_SECRET) return true;
  const received = req.headers['x-bot-api-key'] || '';
  return received === BOT_API_SECRET;
}

const teamApiServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    // ----- Static Dashboard -----
    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard' || pathname === '/dashboard/')) {
      return sendFile(res, path.join(DASHBOARD_DIR, 'index.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && pathname === '/style.css') {
      return sendFile(res, path.join(DASHBOARD_DIR, 'style.css'), 'text/css; charset=utf-8');
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      return sendFile(res, path.join(DASHBOARD_DIR, 'app.js'), 'application/javascript; charset=utf-8');
    }

    // ----- API Auth -----
    const isApi = pathname.startsWith('/api/');
    if (isApi && !checkApiAuth(req)) {
      return sendTeamJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    }

    // Eigenes Limit: Schreib-/Discord-Aktionen max. 20/10s, Lesen max. 60/10s pro Route
    if (isApi) {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      const write = req.method !== 'GET';
      const wait = apiRateLimited(`${ip}|${write ? 'w' : 'r'}|${pathname}`, write ? 20 : 60, 10000);
      if (wait) {
        res.setHeader('Retry-After', String(wait));
        return sendTeamJson(res, 429, { ok: false, error: 'RATE_LIMITED', retryAfter: wait });
      }
    }

    if (isApi && !client.isReady() && pathname !== '/api/dashboard/status') {
      return sendTeamJson(res, 503, { ok: false, error: 'DISCORD_NOT_READY' });
    }

    // ----- /api/team -----
    if (req.method === 'GET' && pathname === '/api/team') {
      const members = await getTeamMembers();
      return sendTeamJson(res, 200, { ok: true, count: members.length, members });
    }

    // ----- /api/roles/sync -----
    if (req.method === 'POST' && pathname === '/api/roles/sync') {
      const body = await readJsonBody(req);
      if (!String(body.username || '').trim()) {
        return sendTeamJson(res, 400, { ok: false, error: 'Discord-Name fehlt.' });
      }
      return sendTeamJson(res, 200, await syncRoles(body));
    }

    // ----- Dashboard: Status -----
    if (req.method === 'GET' && pathname === '/api/dashboard/status') {
      let weatherName = null;
      let moonName = null;
      try {
        const w = await loadWeather();
        if (w) {
          weatherName = (w.icon ? w.icon + ' ' : '') + (w.name || '');
          if (w.moon) moonName = (w.moon.icon ? w.moon.icon + ' ' : '') + (w.moon.name || '');
        }
      } catch {}

      const uptimeSec = process.uptime();
      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);

      return sendTeamJson(res, 200, {
        ok: true,
        online: client.isReady(),
        uptime: `${h}h ${m}m`,
        openTickets: openTickets.size,
        knowledgeCount: knowledge.docs?.length || 0,
        knowledgeUpdated: knowledge.updated
          ? new Date(knowledge.updated).toLocaleString('de-DE')
          : null,
        weather: weatherName,
        moon: moonName
      });
    }

    // ----- Dashboard: Tickets -----
    if (req.method === 'GET' && pathname === '/api/dashboard/tickets') {
      const tickets = [...openTickets.entries()].map(([channelId, t]) => ({
        channelId,
        ...t
      }));
      return sendTeamJson(res, 200, { ok: true, tickets });
    }

    // ----- Dashboard: Character -----
    if (req.method === 'GET' && pathname === '/api/dashboard/character') {
      const q = url.searchParams.get('q') || '';
      const { characters, sheets } = await loadCharData();
      const c = findCharacter(characters, q);
      if (!c) return sendTeamJson(res, 200, { ok: true, character: null });
      return sendTeamJson(res, 200, { ok: true, character: c });
    }

    // ----- Dashboard: Settings GET -----
    if (req.method === 'GET' && pathname === '/api/dashboard/settings') {
      return sendTeamJson(res, 200, {
        ok: true,
        ticketCategoryId: runtimeSettings.ticketCategoryId,
        ticketLogChannelId: runtimeSettings.ticketLogChannelId,
        ticketLimitPerUser: runtimeSettings.ticketLimitPerUser,
        ticketStaffRoleIds: runtimeSettings.ticketStaffRoleIds,
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        botApiPort: BOT_API_PORT
      });
    }

    // ----- Dashboard: Settings POST -----
    if (req.method === 'POST' && pathname === '/api/dashboard/settings') {
      const body = await readJsonBody(req);
      if (body.ticketCategoryId !== undefined) runtimeSettings.ticketCategoryId = String(body.ticketCategoryId || '');
      if (body.ticketLogChannelId !== undefined) runtimeSettings.ticketLogChannelId = String(body.ticketLogChannelId || '');
      if (body.ticketLimitPerUser !== undefined) runtimeSettings.ticketLimitPerUser = Number(body.ticketLimitPerUser) || 2;
      if (Array.isArray(body.ticketStaffRoleIds)) runtimeSettings.ticketStaffRoleIds = body.ticketStaffRoleIds.map(String);

      // Auch in die global genutzten Variablen spiegeln, wo möglich
      // (TICKET_LIMIT_PER_USER ist const – countUserTickets nutzt die const; für Limit nutzen wir runtime)
      return sendTeamJson(res, 200, {
        ok: true,
        message: 'Einstellungen gespeichert (Laufzeit). Für dauerhafte Speicherung in config.env eintragen.',
        settings: runtimeSettings
      });
    }

    // ----- Dashboard: Server Mirror -----
    if (req.method === 'GET' && pathname === '/api/dashboard/server') {
      if (!GUILD_ID) return sendTeamJson(res, 400, { ok: false, error: 'Keine GUILD_ID' });
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return sendTeamJson(res, 404, { ok: false, error: 'Server nicht gefunden' });

      await guild.channels.fetch().catch(() => {});
      await guild.roles.fetch().catch(() => {});

      const channels = [...guild.channels.cache.values()]
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          parentId: c.parentId
        }));

      const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => ({
          id: r.id,
          name: r.name,
          color: r.hexColor === '#000000' ? null : r.hexColor,
          memberCount: r.members?.size ?? 0,
          position: r.position
        }));

      return sendTeamJson(res, 200, {
        ok: true,
        name: guild.name,
        memberCount: guild.memberCount,
        channels,
        roles
      });
    }

    // ----- Dashboard: Refresh Knowledge -----
    if (req.method === 'POST' && pathname === '/api/dashboard/refresh-knowledge') {
      await refreshKnowledge();
      return sendTeamJson(res, 200, {
        ok: true,
        message: 'Wissen aktualisiert',
        count: knowledge.docs?.length || 0
      });
    }


    // ----- Dashboard: Channel Messages -----
    if (req.method === 'GET' && pathname === '/api/dashboard/messages') {
      const channelId = url.searchParams.get('channelId');
      if (!channelId) return sendTeamJson(res, 400, { ok: false, error: 'channelId fehlt' });

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return sendTeamJson(res, 404, { ok: false, error: 'Channel nicht gefunden oder kein Text-Channel' });
      }

      const messages = await channel.messages.fetch({ limit: 30 });
      const list = [...messages.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m => ({
          id: m.id,
          content: m.content,
          author: m.author?.username || '?',
          authorId: m.author?.id,
          bot: !!m.author?.bot,
          createdAt: m.createdAt.toISOString(),
          attachments: [...m.attachments.values()].map(a => a.url)
        }));

      return sendTeamJson(res, 200, {
        ok: true,
        channelId,
        channelName: channel.name,
        messages: list
      });
    }

    // ----- Dashboard: Nachricht senden (als Bot) -----
    if (req.method === 'POST' && pathname === '/api/dashboard/send') {
      const body = await readJsonBody(req);
      const channelId = String(body.channelId || '').trim();
      const content = String(body.content || '').trim();

      if (!channelId || !content) {
        return sendTeamJson(res, 400, { ok: false, error: 'channelId und content erforderlich' });
      }
      if (content.length > 2000) {
        return sendTeamJson(res, 400, { ok: false, error: 'Nachricht zu lang (max 2000)' });
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return sendTeamJson(res, 404, { ok: false, error: 'Channel nicht gefunden' });
      }

      const msg = await channel.send({ content });
      return sendTeamJson(res, 200, {
        ok: true,
        message: 'Gesendet',
        id: msg.id,
        channelId
      });
    }

    // ----- Dashboard: Ticket erstellen -----
    if (req.method === 'POST' && pathname === '/api/dashboard/tickets/create') {
      const body = await readJsonBody(req);
      const typeId = String(body.type || 'support').trim();
      const userId = String(body.userId || '').trim();

      if (!userId) return sendTeamJson(res, 400, { ok: false, error: 'userId fehlt' });
      if (!GUILD_ID) return sendTeamJson(res, 400, { ok: false, error: 'Keine GUILD_ID' });

      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return sendTeamJson(res, 404, { ok: false, error: 'Server nicht gefunden' });

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return sendTeamJson(res, 404, { ok: false, error: 'User nicht auf dem Server' });

      const limit = runtimeSettings.ticketLimitPerUser || TICKET_LIMIT_PER_USER;
      if (countUserTickets(userId) >= limit) {
        return sendTeamJson(res, 400, { ok: false, error: `User hat bereits ${limit} offene Tickets` });
      }

      const channel = await createTicketChannel(guild, member.user, typeId);
      return sendTeamJson(res, 200, {
        ok: true,
        message: 'Ticket erstellt',
        channelId: channel.id,
        channelName: channel.name
      });
    }

    // ----- Dashboard: Role Panels GET/POST -----
    if (req.method === 'GET' && pathname === '/api/dashboard/roles-panels') {
      return sendTeamJson(res, 200, { ok: true, panels: savedRolePanels });
    }

    if (req.method === 'POST' && pathname === '/api/dashboard/roles-panels') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.panels)) {
        return sendTeamJson(res, 400, { ok: false, error: 'panels Array erforderlich' });
      }
      savedRolePanels = body.panels;
      saveRolePanels();
      return sendTeamJson(res, 200, { ok: true, message: 'Rollen-Panels gespeichert', panels: savedRolePanels });
    }

    // ----- Dashboard: Role Panel in Channel posten -----
    if (req.method === 'POST' && pathname === '/api/dashboard/roles-panels/post') {
      const body = await readJsonBody(req);
      const channelId = String(body.channelId || '').trim();
      if (!channelId) return sendTeamJson(res, 400, { ok: false, error: 'channelId fehlt' });

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return sendTeamJson(res, 404, { ok: false, error: 'Channel nicht gefunden' });
      }

      const panels = (body.panels && Array.isArray(body.panels)) ? body.panels : savedRolePanels;
      if (!panels.length) {
        return sendTeamJson(res, 400, { ok: false, error: 'Keine Panels vorhanden' });
      }

      let posted = 0;
      for (const panel of panels) {
        if (!panel.roles || !panel.roles.length) continue;

        const embed = new EmbedBuilder()
          .setTitle(panel.title || 'Rollen')
          .setDescription(panel.description || 'Klicke auf die Buttons, um Rollen zu erhalten oder zu entfernen.')
          .setColor(typeof panel.color === 'number' ? panel.color : 0xa855f7)
          .setFooter({ text: panel.footer || 'Chroniken · Rollen wählen' });

        const rows = [];
        let currentRow = new ActionRowBuilder();

        for (let i = 0; i < panel.roles.length; i++) {
          const r = panel.roles[i];
          const btn = new ButtonBuilder()
            .setCustomId(`role_toggle_${r.id}`)
            .setLabel((r.label || 'Rolle').slice(0, 80))
            .setStyle(ButtonStyle.Secondary);
          if (r.emoji) {
            try { btn.setEmoji(r.emoji); } catch {}
          }
          currentRow.addComponents(btn);
          if (currentRow.components.length === 5 || i === panel.roles.length - 1) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
          }
        }

        await channel.send({ embeds: [embed], components: rows });
        await sleep(400);
        posted++;
      }

      return sendTeamJson(res, 200, { ok: true, message: `${posted} Panel(s) gepostet`, posted });
    }

    // ----- Dashboard: Schönes Regeln-Embed posten (wie Carl-Bot, aber besser) -----
    if (req.method === 'POST' && pathname === '/api/dashboard/post-rules') {
      const body = await readJsonBody(req);
      const channelId = String(body.channelId || '').trim();
      if (!channelId) return sendTeamJson(res, 400, { ok: false, error: 'channelId fehlt' });

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return sendTeamJson(res, 404, { ok: false, error: 'Channel nicht gefunden' });
      }

      const title = body.title || '📜 Willkommen auf Chroniken';
      const intro = body.intro || 'Mit dem Betreten des Servers akzeptierst du unser Regelwerk. Die Regeln gelten für alle Spieler. Verstöße können zu Verwarnungen, Kicks oder einem Ausschluss führen.';
      const rules = Array.isArray(body.rules) && body.rules.length ? body.rules : [
        { emoji: '📖', title: '1. Respekt', text: 'Behandle alle Spieler respektvoll. Beleidigungen, Mobbing, Stalking, Rassismus, Diskriminierung und Volksverhetzung sind verboten.' },
        { emoji: '💬', title: '2. Chat', text: 'Spam, Flooding, dauerhaftes CAPS-Lock, unnötiges Provozieren und störendes Verhalten sind verboten. Werbung für andere Server oder Communities ist ohne Erlaubnis nicht gestattet.' },
        { emoji: '🤝', title: '3. Konflikte', text: 'Streit wird sachlich geklärt. Provokationen und absichtliches Eskalieren sind zu unterlassen. Bei Problemen wende dich an das Team.' },
        { emoji: '🛡️', title: '4. Team', text: 'Den Anweisungen von Admins und Moderatoren ist Folge zu leisten. Support läuft ausschließlich über das Ticket-System – keine privaten Nachrichten an Teammitglieder zu Supportzwecken.' },
        { emoji: '🔧', title: '5. Fair Play', text: 'Bugusing, Exploits, Glitches und das Ausnutzen von Spielfehlern zum eigenen Vorteil sind verboten. Fehler müssen dem Team gemeldet werden.' },
        { emoji: '🎭', title: '6. Rollenspiel', text: 'Respektiere die Grenzen anderer Spieler. Intensive RP-Handlungen benötigen die Zustimmung aller Beteiligten. Ein „Nein“ ist jederzeit zu akzeptieren.' },
        { emoji: '🔞', title: '7. Mindestalter', text: 'Die Teilnahme ist ausschließlich ab 18 Jahren erlaubt.' },
        { emoji: '💙', title: '8. Discord', text: 'Die Nutzung unseres Discords ist Pflicht. Dein Discord-Nickname muss deinem Ingame-Charakternamen entsprechen.' },
        { emoji: '🇩🇪', title: '9. Sprache', text: 'Die offizielle Serversprache ist Deutsch.' }
      ];

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(intro)
        .setColor(0xa855f7)
        .setFooter({ text: 'Viel Spaß in der Welt von Chroniken' });

      for (const r of rules.slice(0, 20)) {
        embed.addFields({
          name: `${r.emoji || '•'} ${r.title}`,
          value: r.text || '—',
          inline: false
        });
      }

      if (body.important) {
        embed.addFields({
          name: '⚠️ Wichtig',
          value: body.important,
          inline: false
        });
      }

      await channel.send({ embeds: [embed] });
      return sendTeamJson(res, 200, { ok: true, message: 'Regel-Embed gepostet' });
    }


    // ----- Dashboard: Welcome settings -----
    if (req.method === 'GET' && pathname === '/api/dashboard/welcome') {
      return sendTeamJson(res, 200, {
        ok: true,
        settings: {
          ...welcomeSettings,
          hasLocalImage: fs.existsSync(WELCOME_IMAGE)
        }
      });
    }

    if (req.method === 'POST' && pathname === '/api/dashboard/welcome') {
      const body = await readJsonBody(req, 500000);
      if (body.channelId !== undefined) welcomeSettings.channelId = String(body.channelId || '');
      if (body.title !== undefined) welcomeSettings.title = String(body.title || '');
      if (body.description !== undefined) welcomeSettings.description = String(body.description || '');
      if (body.content !== undefined) welcomeSettings.content = String(body.content || '');
      if (body.footer !== undefined) welcomeSettings.footer = String(body.footer || '');
      if (body.color !== undefined) {
        const col = body.color;
        welcomeSettings.color = typeof col === 'number' ? col : parseInt(String(col).replace('#', ''), 16) || 0xa855f7;
      }
      if (body.imageUrl !== undefined) welcomeSettings.imageUrl = String(body.imageUrl || '');
      if (body.enabled !== undefined) welcomeSettings.enabled = !!body.enabled;

      // Optionales Bild als Base64 (data URL oder pure base64 jpeg/png)
      if (body.imageBase64) {
        try {
          let b64 = String(body.imageBase64);
          const m = b64.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
          if (m) b64 = m[2];
          const buf = Buffer.from(b64, 'base64');
          if (buf.length > 8_000_000) {
            return sendTeamJson(res, 400, { ok: false, error: 'Bild zu groß (max ~8MB)' });
          }
          fs.writeFileSync(WELCOME_IMAGE, buf);
          welcomeSettings.imageUrl = ''; // lokale Datei nutzen
        } catch (e) {
          return sendTeamJson(res, 400, { ok: false, error: 'Bild konnte nicht gespeichert werden: ' + e.message });
        }
      }

      saveWelcomeSettings();
      return sendTeamJson(res, 200, {
        ok: true,
        message: 'Willkommen-Einstellungen gespeichert',
        settings: { ...welcomeSettings, hasLocalImage: fs.existsSync(WELCOME_IMAGE) }
      });
    }

    // Test-Willkommen senden
    if (req.method === 'POST' && pathname === '/api/dashboard/welcome/test') {
      const body = await readJsonBody(req);
      if (!GUILD_ID) return sendTeamJson(res, 400, { ok: false, error: 'Keine GUILD_ID' });
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return sendTeamJson(res, 404, { ok: false, error: 'Server nicht gefunden' });

      let member = null;
      const userId = String(body.userId || '').trim();
      if (userId) {
        member = await guild.members.fetch(userId).catch(() => null);
      }
      if (!member) {
        // Fallback: ersten verfügbaren Nicht-Bot oder den Bot-Owner-ähnlichen
        await ensureMembers(guild);
        member = guild.members.cache.find(m => !m.user.bot) || guild.members.cache.first();
      }
      if (!member) {
        return sendTeamJson(res, 400, { ok: false, error: 'Kein Mitglied zum Testen gefunden' });
      }

      await sendWelcomeMessage(member, { force: true, channelId: body.channelId || welcomeSettings.channelId });
      return sendTeamJson(res, 200, {
        ok: true,
        message: `Test-Willkommen gesendet für ${member.user.tag}`
      });
    }


    // ----- Dashboard: Ticket Settings (tickets.bot style) -----
    if (req.method === 'GET' && pathname === '/api/dashboard/ticket-settings') {
      return sendTeamJson(res, 200, {
        ok: true,
        settings: ticketSettings,
        runtime: {
          categoryId: runtimeSettings.ticketCategoryId,
          logChannelId: runtimeSettings.ticketLogChannelId,
          limit: runtimeSettings.ticketLimitPerUser,
          staffRoleIds: runtimeSettings.ticketStaffRoleIds
        }
      });
    }

    if (req.method === 'POST' && pathname === '/api/dashboard/ticket-settings') {
      const body = await readJsonBody(req);
      if (body.panelTitle !== undefined) ticketSettings.panelTitle = String(body.panelTitle);
      if (body.panelDescription !== undefined) ticketSettings.panelDescription = String(body.panelDescription);
      if (body.panelFooter !== undefined) ticketSettings.panelFooter = String(body.panelFooter);
      if (body.ticketWelcome !== undefined) ticketSettings.ticketWelcome = String(body.ticketWelcome);
      if (body.namingPattern !== undefined) ticketSettings.namingPattern = String(body.namingPattern);
      if (body.mentionStaffOnOpen !== undefined) ticketSettings.mentionStaffOnOpen = !!body.mentionStaffOnOpen;
      if (body.panelColor !== undefined) {
        const col = body.panelColor;
        ticketSettings.panelColor = typeof col === 'number' ? col : parseInt(String(col).replace('#', ''), 16) || 0xa855f7;
      }
      if (Array.isArray(body.types)) ticketSettings.types = body.types;
      saveTicketSettings();
      return sendTeamJson(res, 200, { ok: true, message: 'Ticket-Einstellungen gespeichert', settings: ticketSettings });
    }

    // Panel in Channel posten
    if (req.method === 'POST' && pathname === '/api/dashboard/ticket-panel/post') {
      const body = await readJsonBody(req);
      const channelId = String(body.channelId || '').trim();
      if (!channelId) return sendTeamJson(res, 400, { ok: false, error: 'channelId fehlt' });
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return sendTeamJson(res, 404, { ok: false, error: 'Channel nicht gefunden' });
      }
      await channel.send({
        embeds: [buildTicketPanelEmbed()],
        components: buildTicketPanelComponents()
      });
      return sendTeamJson(res, 200, { ok: true, message: 'Ticket-Panel gepostet' });
    }

    // Ticket schließen vom Dashboard
    if (req.method === 'POST' && pathname === '/api/dashboard/tickets/close') {
      const body = await readJsonBody(req);
      const channelId = String(body.channelId || '').trim();
      if (!channelId || !openTickets.has(channelId)) {
        return sendTeamJson(res, 404, { ok: false, error: 'Ticket nicht gefunden' });
      }
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        openTickets.delete(channelId);
        saveTickets();
        return sendTeamJson(res, 200, { ok: true, message: 'Ticket aus Liste entfernt (Channel weg)' });
      }
      const closer = { id: client.user.id, tag: client.user.tag };
      await closeTicket(channel, closer, body.reason || 'Über Dashboard geschlossen');
      return sendTeamJson(res, 200, { ok: true, message: 'Ticket geschlossen' });
    }

    // 404
    return sendTeamJson(res, 404, { ok: false, error: 'NOT_FOUND' });




  } catch (error) {
    if (error && error.status && error.status < 500) {
      return sendTeamJson(res, error.status, {
        ok: false,
        error: error.message,
        code: error.code || undefined
      });
    }

    console.error('API Fehler:', error?.stack || error?.message || error);
    return sendTeamJson(res, 500, {
      ok: false,
      error: error?.message || 'Unbekannter Fehler',
      code: 'API_ERROR'
    });
  }
});

teamApiServer.listen(
  BOT_API_PORT,
  '0.0.0.0',
  () => {
    console.log(`Chroniken Dashboard + API läuft auf http://0.0.0.0:${BOT_API_PORT}`);
    console.log(`  Dashboard:  http://localhost:${BOT_API_PORT}/`);
    console.log(`  Team-API:   http://localhost:${BOT_API_PORT}/api/team`);

    const files = ['index.html', 'style.css', 'app.js'];
    for (const f of files) {
      const p = path.join(DASHBOARD_DIR, f);
      console.log(`  Dashboard-Datei ${f}: ${fs.existsSync(p) ? 'OK' : 'FEHLT → ' + p}`);
    }
  }
);


// ============================================================
// WILLKOMMEN (episch – Buch der Chroniken)
// ============================================================

client.on('guildMemberAdd', async member => {
  try {
    if (GUILD_ID && member.guild.id !== GUILD_ID) return;
    await sendWelcomeMessage(member);
    console.log(`Welcome gesendet für ${member.user.tag}`);
  } catch (e) {
    console.error('Welcome-Fehler:', e.message || e);
  }
});

// Bei fehlendem/ungültigem Token NICHT beenden: ein Prozess-Neustart (z. B. durch Render) würde
// sonst endlos neu einloggen und das Invalid-Request-Limit (10.000/10 min) auslösen.
if (!TOKEN) {
  console.error('DISCORD_BOT_TOKEN fehlt – kein Login (Dashboard läuft weiter).');
} else {
  client.login(TOKEN).catch(e => {
    console.error('Login fehlgeschlagen (Token prüfen):', e && e.message || e);
  });
}