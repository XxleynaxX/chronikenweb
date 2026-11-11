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
const PLAYER_ROLE_ID = process.env.PLAYER_ROLE_ID || '1254552933157306418';
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
    await updatePresence();

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


// ============================================================
// TAGEBUCH · Discord-ID → eigener Charakter
// ============================================================

function isDiaryPlayerMember(member) {
  return !!member?.roles?.cache?.has(PLAYER_ROLE_ID);
}

function isDiaryAdminMember(member) {
  return isAdminMember(member);
}

function characterDiscordIds(character) {
  return [
    character?.discordId,
    character?.discord_id,
    character?.discordUserId,
    character?.discord_user_id,
    character?.ownerId,
    character?.owner_id,
    character?.playerId,
    character?.player_id
  ].filter(Boolean).map(String);
}

async function findDiaryCharacter(member) {
  const { characters } = await loadCharData();
  const discordId = String(member.id);

  const direct = characters.find(c => characterDiscordIds(c).includes(discordId));
  if (direct) return direct;

  const names = [
    member.user?.username,
    member.user?.globalName,
    member.displayName,
    member.nickname
  ].filter(Boolean).map(cleanDiscordName);

  const candidates = characters.filter(c => {
    const values = [
      c.discordName,
      c.discord_name,
      c.player,
      c.playerName,
      c.player_name
    ].filter(Boolean).map(cleanDiscordName);
    return values.some(v => names.includes(v));
  });

  return candidates.length === 1 ? candidates[0] : null;
}

function diaryWebsiteUrl(member) {
  return isDiaryAdminMember(member) ? SITE + 'admin/tagebuch.html' : SITE + 'tagebuch.html';
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
      .setName('tagebuch')
      .setDescription('Öffnet dein Chroniken-Tagebuch (nur Spieler/Admins)')
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
    console.log('Slash-Commands registriert: /char, /tagebuch, /ticket-panel, /ticket-close, /roles-panel');
  } catch (e) {
    console.error('Slash-Commands konnten nicht registriert werden:', e.message);
  }
}

client.on('interactionCreate', async interaction => {
  try {
    if (GUILD_ID && interaction.guildId !== GUILD_ID) return;

    // ---------- Tagebuch ----------
    if (interaction.isChatInputCommand() && interaction.commandName === 'tagebuch') {
      const member = interaction.member;

      if (!isDiaryAdminMember(member) && !isDiaryPlayerMember(member)) {
        return interaction.reply({
          content: '❌ Dein Discord-Konto hat nicht die Spieler-Rolle für das Tagebuch.',
          flags: 64
        });
      }

      try {
        const character = isDiaryAdminMember(member) ? null : await findDiaryCharacter(member);

        if (!isDiaryAdminMember(member) && !character) {
          return interaction.reply({
            content: '⚠️ Für deine Discord-ID ist noch kein Charakter hinterlegt. Bitte wende dich an das Team.',
            flags: 64
          });
        }

        const target = diaryWebsiteUrl(member);
        const reply = isDiaryAdminMember(member)
          ? `📓 **Admin-Tagebuch**\n\nDu kannst die Tagebücher aller Charaktere verwalten.\n<${target}>`
          : `📓 **Dein Tagebuch**\n\nCharakter: **${character.name || 'Unbenannt'}** · ${character.id}\nDiscord-ID: \`${member.id}\`\n\n<${target}>`;

        return interaction.reply({ content: reply, flags: 64 });
      } catch (e) {
        console.error('Tagebuch-Zuordnung fehlgeschlagen:', e);
        return interaction.reply({
          content: '❌ Das Tagebuch konnte gerade nicht geladen werden.',
          flags: 64
        });
      }
    }

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
          return sendTeamJson(res, 400, { async function updatePresence() {
  if (!client.isReady()) return;

  const mods = await loadMods().catch(() => modsCache.list || []);
  const live = await loadWeather().catch(() => null);
  const activities = [];

  if (live?.name) {
    activities.push({ name: `${live.icon || ''} ${live.name}`.trim().slice(0, 100), type: ActivityType.Watching });
  }
  if (live?.moon?.name) {
    activities.push({ name: `${live.moon.icon || '🌙'} ${live.moon.name}`.trim().slice(0, 100), type: ActivityType.Watching });
  }
  if (mods.length) {
    activities.push({ name: `${mods.length} Conan-Mods aktiv`, type: ActivityType.Playing });
  }
  activities.push({ name: 'den Chroniken', type: ActivityType.Listening });
  activities.push({ name: 'Chroniken RP', type: ActivityType.Playing });

  const activity = activities[presenceIndex % activities.length];
  presenceIndex++;

  try {
    client.user.setPresence({ activities: [activity], status: 'online' });
  } catch (e) {
    console.warn('Presence-Update fehlgeschlagen:', e.message);
  }
}

ok: false, error: 'Bild konnte nicht gespeichert werden: ' + e.message });
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