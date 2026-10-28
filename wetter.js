/**
 * Chroniken – Wetter-Kern (Browser)
 *
 * Gemeinsamer Zustand liegt im zentralen Events-Bin unter "weather" (als Array mit einem Zustandsobjekt):
 *   { intervalMinutes, weather:[{name,icon,description,weight}], anchor, seed,
 *     forced:{name,icon,description}|null, forcedSlot, title, text, updatedAt }
 * Ohne gespeicherten Zustand gilt weather-config.js (gleiche Auswahl wie früher).
 *
 * Webseite und Render-Proxy (chroniken-discord-proxy/weather.js) berechnen
 * das Wetter mit derselben Formel → überall gleiches Wetter, gleicher Timer.
 * Der Proxy postet jeden Wechsel in Discord (DISCORD_WEATHER_WEBHOOK).
 */
(function () {
  "use strict";

  var PROXY = "https://chronikenweb-1.onrender.com";
  var CACHE_KEY = "chroniken_weather_shared_v1";
  var DEFAULT_TITLE = "🌦️ Wetter in Chroniken";
  var DEFAULT_TEXT = "%wetter_icon% %wetter% ist jetzt bei Chroniken.\n\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%";
  var FALLBACK_WEATHER = [
    { name: "Klarer Himmel", icon: "☀️", description: "Ein ruhiger, heller Tag liegt über dem Land.", weight: 12 },
    { name: "Bewölkt", icon: "☁️", description: "Wolken ziehen über den Himmel, doch es bleibt trocken.", weight: 12 },
    { name: "Leichter Regen", icon: "🌦️", description: "Feiner Regen fällt und lässt die Straßen glänzen.", weight: 10 }
  ];

  function proxyBase() {
    try {
      var saved = localStorage.getItem("chroniken_discord_proxy_url");
      if (saved && saved.trim()) return saved.trim().replace(/\/$/, "");
    } catch (e) {}
    return PROXY;
  }

  /* ---------- Normalisieren ---------- */
  function cleanWeather(w) {
    w = w || {};
    return {
      name: String(w.name || "").trim() || "Unbenannt",
      icon: String(w.icon || "").trim() || "🌤️",
      description: String(w.description || "").trim(),
      weight: Math.max(0, Number(w.weight) || 0)
    };
  }

  function fileConfig() {
    var raw = (typeof globalThis !== "undefined" && globalThis.CHRONIKEN_WEATHER_CONFIG) || null;
    var list = raw && Array.isArray(raw.weather) && raw.weather.length ? raw.weather : FALLBACK_WEATHER;
    return {
      intervalMinutes: Math.max(1, Number(raw && raw.intervalHours) || 6) * 60,
      weather: list.map(cleanWeather)
    };
  }

  function normalize(raw) {
    var base = fileConfig();
    raw = raw && typeof raw === "object" ? raw : {};
    var list = Array.isArray(raw.weather) && raw.weather.length ? raw.weather.map(cleanWeather) : base.weather;
    return {
      intervalMinutes: Math.max(1, Math.round(Number(raw.intervalMinutes) || base.intervalMinutes)),
      weather: list,
      anchor: Number(raw.anchor) || 0,
      seed: Math.max(0, Math.floor(Number(raw.seed) || 0)),
      forced: raw.forced && raw.forced.name ? cleanWeather(raw.forced) : null,
      forcedSlot: Math.max(0, Math.floor(Number(raw.forcedSlot) || 0)),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title : DEFAULT_TITLE,
      text: typeof raw.text === "string" && raw.text.trim() ? raw.text : DEFAULT_TEXT,
      updatedAt: Number(raw.updatedAt) || 0
    };
  }

  /* ---------- Auswahl (identisch im Proxy) ---------- */
  function randomIndex(seed, length) {
    if (!length || length < 1) return 0;
    var x = (seed * 1103515245 + 12345) >>> 0;
    x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
    return x % length;
  }

  function pickWeighted(seed, list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    if (total <= 0) return list[randomIndex(seed, list.length)] || list[0];
    var r = randomIndex(seed, total);
    for (i = 0; i < list.length; i++) { r -= list[i].weight; if (r < 0) return list[i]; }
    return list[list.length - 1];
  }

  function compute(st, now) {
    now = now == null ? Date.now() : now;
    var ms = st.intervalMinutes * 60000;
    var k = Math.max(0, Math.floor((now - st.anchor) / ms));
    var forced = !!(st.forced && k === st.forcedSlot);
    var w = forced ? st.forced : pickWeighted(st.seed + k, st.weather);
    return {
      key: st.anchor + ":" + k,
      slot: k,
      name: w.name,
      icon: w.icon,
      description: w.description,
      weight: w.weight,
      forced: forced,
      intervalMinutes: st.intervalMinutes,
      intervalHours: st.intervalMinutes / 60,
      changedAt: new Date(st.anchor + k * ms).toISOString(),
      nextAt: st.anchor + (k + 1) * ms
    };
  }

  /* ---------- Zustand laden ---------- */
  var shared = (function () {
    try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); if (c) return normalize(c); } catch (e) {}
    return normalize(null);
  })();
  var lastKey = null;

  function emit() {
    var cur = compute(shared);
    try { window.dispatchEvent(new CustomEvent("chroniken-weather-changed", { detail: cur })); } catch (e) {}
    return cur;
  }

  function apply(raw) {
    var next = normalize(raw);
    var changed = JSON.stringify(next) !== JSON.stringify(shared);
    shared = next;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(raw || null)); } catch (e) {}
    if (changed) { lastKey = compute(shared).key; emit(); }
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("Zeitüberschreitung")); }, ms); })]);
  }

  async function refresh() {
    try {
      var r = await withTimeout(fetch(proxyBase() + "/weather/state", { cache: "no-store" }), 6000);
      var d = await r.json();
      if (r.ok && d && d.ok && d.source === "jsonbin") { apply(d.state); return "proxy"; }
    } catch (e) {}
    try {
      if (window.ChronikenStorage) { apply(await ChronikenStorage.refresh("weather")); return "jsonbin"; }
    } catch (e) {}
    return "cache";
  }

  /* ---------- Admin-Aktionen (speichern im Haupt-Bin, Proxy neu laden lassen) ---------- */
  function randomSeed() { return Math.floor(Math.random() * 1000000); }

  function pickRandom(list, excludeName) {
    var pool = list.filter(function (w) { return w.name !== excludeName; });
    if (!pool.length) pool = list.slice();
    var total = pool.reduce(function (s, w) { return s + w.weight; }, 0);
    if (total <= 0) return pool[Math.floor(Math.random() * pool.length)];
    var r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r < 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  function plain(w) { return { name: w.name, icon: w.icon, description: w.description, weight: w.weight }; }

  async function update(mutator) {
    if (!window.ChronikenStorage) throw new Error("jsonbin-storage.js fehlt");
    var latest = normalize(await ChronikenStorage.refresh("weather"));
    var now = Date.now();
    var next = mutator(latest, compute(latest, now), now) || latest;
    next.updatedAt = now;
    var record = {
      intervalMinutes: next.intervalMinutes,
      weather: next.weather.map(plain),
      anchor: next.anchor, seed: next.seed,
      forced: next.forced ? plain(next.forced) : null,
      forcedSlot: next.forcedSlot,
      title: next.title, text: next.text,
      updatedAt: next.updatedAt
    };
    await ChronikenStorage.save("weather", record);
    apply(record);
    var discord = false;
    try {
      var r = await withTimeout(fetch(proxyBase() + "/weather/reload", { method: "POST" }), 45000);
      discord = r.ok;
    } catch (e) {}
    return { state: compute(shared), proxy: discord };
  }

  function restartWith(w) {
    return function (st, cur, now) {
      st.anchor = now; st.seed = randomSeed(); st.forced = cleanWeather(w || cur); st.forcedSlot = 0;
      return st;
    };
  }

  var api = {
    get: function () { return compute(shared); },
    msNext: function () { return Math.max(0, compute(shared).nextAt - Date.now()); },
    nextChangeTime: function () { return new Date(compute(shared).nextAt); },
    format: function (ms) {
      var t = Math.max(0, Math.floor(Number(ms) / 1000));
      var d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
      var hms = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      return d ? d + "T " + hms : hms;
    },
    formatInterval: function (min) {
      min = Number(min) || 0;
      if (min % 1440 === 0) return (min / 1440) + (min === 1440 ? " Tag" : " Tage");
      if (min % 60 === 0) return (min / 60) + (min === 60 ? " Stunde" : " Stunden");
      return min + (min === 1 ? " Minute" : " Minuten");
    },
    getShared: function () { return JSON.parse(JSON.stringify(shared)); },
    getWeatherList: function () { return shared.weather.slice(); },
    loadConfig: function () { return { intervalHours: shared.intervalMinutes / 60, intervalMinutes: shared.intervalMinutes, weather: shared.weather.slice() }; },
    refresh: refresh,
    // Admin
    chooseWeather: function (w) { return update(restartWith(w)); },
    skipWeather: function () {
      return update(function (st, cur, now) { return restartWith(pickRandom(st.weather, cur.name))(st, cur, now); });
    },
    resetTimer: function () { return update(restartWith(null)); },
    setIntervalMinutes: function (min) {
      min = Math.max(1, Math.round(Number(min) || 0));
      return update(function (st, cur, now) { st.intervalMinutes = min; return restartWith(null)(st, cur, now); });
    },
    saveWeatherList: function (list) {
      list = (list || []).map(cleanWeather).filter(function (w) { return w.name; });
      if (!list.length) return Promise.reject(new Error("Mindestens eine Wetterlage nötig"));
      // aktuelles Wetter + Timer bleiben unverändert
      return update(function (st, cur) { st.forced = cleanWeather(cur); st.forcedSlot = cur.slot; st.weather = list; return st; });
    },
    saveTemplate: function (title, text) {
      return update(function (st) { st.title = String(title || "").trim() || DEFAULT_TITLE; st.text = String(text || "").trim() || DEFAULT_TEXT; return st; });
    },
    DEFAULT_TITLE: DEFAULT_TITLE,
    DEFAULT_TEXT: DEFAULT_TEXT,
    _compute: compute,
    _normalize: normalize
  };

  setInterval(function () {
    var cur = compute(shared);
    if (lastKey === null) { lastKey = cur.key; return; }
    if (cur.key !== lastKey) { lastKey = cur.key; emit(); }
  }, 1000);
  setInterval(refresh, 60 * 1000);
  refresh();

  window.ChronikenWeather = api;
})();
