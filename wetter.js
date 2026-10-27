/**
 * Chroniken – Wetter-Kern (Browser + Node/Discord)
 * Config: localStorage (Admin) > weather-config.js
 * Live: forceWeather / skipWeather / resetTimer / clearOverride (nur Browser)
 */
(function () {
  "use strict";

  var STORAGE_KEY = "chroniken_weather_config_v2";
  var OVERRIDE_KEY = "chroniken_weather_override_v1";

  function getFileConfig() {
    var raw = null;
    try {
      if (typeof CHRONIKEN_WEATHER_CONFIG !== "undefined" && CHRONIKEN_WEATHER_CONFIG) {
        raw = CHRONIKEN_WEATHER_CONFIG;
      } else if (typeof globalThis !== "undefined" && globalThis.CHRONIKEN_WEATHER_CONFIG) {
        raw = globalThis.CHRONIKEN_WEATHER_CONFIG;
      }
    } catch (e) {}

    if (!raw || !Array.isArray(raw.weather) || !raw.weather.length) {
      return {
        intervalHours: 6,
        weather: [
          { name: "Klarer Himmel", icon: "☀️", description: "Ein ruhiger, heller Tag liegt über dem Land.", weight: 12 },
          { name: "Leichter Wind", icon: "🍃", description: "Ein sanfter Wind zieht durch Wälder und Gassen.", weight: 12 },
          { name: "Bewölkt", icon: "☁️", description: "Wolken ziehen über den Himmel, doch es bleibt trocken.", weight: 12 },
          { name: "Nebel", icon: "🌫️", description: "Dichter Nebel liegt über dem Land und verschluckt die Ferne.", weight: 8 },
          { name: "Leichter Regen", icon: "🌦️", description: "Feiner Regen fällt und lässt die Straßen glänzen.", weight: 10 },
          { name: "Starker Regen", icon: "🌧️", description: "Kräftiger Regen prasselt auf Dächer und Wege.", weight: 6 },
          { name: "Gewitter", icon: "⛈️", description: "Donner grollt am Horizont und Blitze erhellen die Wolken.", weight: 4 },
          { name: "Starker Wind", icon: "🌬️", description: "Böen ziehen durch das Land und lassen Äste rauschen.", weight: 8 },
          { name: "Schneefall", icon: "🌨️", description: "Leiser Schnee fällt vom Himmel und bedeckt die Landschaft.", weight: 5 },
          { name: "Starker Schneefall", icon: "❄️", description: "Dichter Schnee fällt und macht Wege langsam schwer passierbar.", weight: 3 },
          { name: "Frost", icon: "🥶", description: "Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft.", weight: 5 },
          { name: "Dunstiger Morgen", icon: "🌤️", description: "Heller Dunst liegt über dem Land und löst sich langsam auf.", weight: 5 }
        ]
      };
    }
    return normalizeConfig(raw);
  }

  function normalizeConfig(raw) {
    raw = raw || {};
    return {
      intervalHours: Math.max(1, Number(raw.intervalHours) || 6),
      weather: (raw.weather || []).map(function (w) {
        w = w || {};
        return {
          name: String(w.name || "Unbekannt").trim() || "Unbenannt",
          icon: String(w.icon || "🌤️").trim() || "🌤️",
          description: String(w.description || "").trim(),
          weight: Math.max(0, Number(w.weight) || 0)
        };
      })
    };
  }

  function loadConfig() {
    try {
      if (typeof localStorage !== "undefined") {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.weather) && parsed.weather.length) {
            return normalizeConfig(parsed);
          }
        }
      }
    } catch (e) {}
    return getFileConfig();
  }

  function slotMs(cfg) {
    return Math.max(1, (cfg && cfg.intervalHours) || 6) * 60 * 60 * 1000;
  }

  function currentSlot(cfg) {
    return Math.floor(Date.now() / slotMs(cfg));
  }

  function randomIndex(seed, length) {
    if (!length || length < 1) return 0;
    var x = (seed * 1103515245 + 12345) >>> 0;
    x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
    return x % length;
  }

  function pickWeighted(seed, list) {
    list = list || [];
    if (!list.length) {
      return { name: "Unbekannt", icon: "🌤️", description: "", weight: 0 };
    }
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      total += Math.max(0, Number(list[i].weight) || 0);
    }
    if (total <= 0) {
      return list[randomIndex(seed, list.length)] || list[0];
    }
    var r = randomIndex(seed, total);
    for (var j = 0; j < list.length; j++) {
      r -= Math.max(0, Number(list[j].weight) || 0);
      if (r < 0) return list[j];
    }
    return list[list.length - 1];
  }

  function pickRandom(list, excludeName) {
    list = list || [];
    var pool = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && (!excludeName || list[i].name !== excludeName)) pool.push(list[i]);
    }
    if (!pool.length) pool = list.slice();
    if (!pool.length) return { name: "Unbekannt", icon: "🌤️", description: "", weight: 1 };
    var total = 0;
    for (var j = 0; j < pool.length; j++) total += Math.max(0, Number(pool[j].weight) || 0);
    if (total <= 0) return pool[Math.floor(Math.random() * pool.length)];
    var r = Math.random() * total;
    for (var k = 0; k < pool.length; k++) {
      r -= Math.max(0, Number(pool[k].weight) || 0);
      if (r < 0) return pool[k];
    }
    return pool[pool.length - 1];
  }

  function readOverride() {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(OVERRIDE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.until || !o.name) return null;
      if (Date.now() >= Number(o.until)) {
        try { localStorage.removeItem(OVERRIDE_KEY); } catch (e) {}
        return null;
      }
      return o;
    } catch (e) {
      return null;
    }
  }

  function writeOverride(o) {
    try {
      if (typeof localStorage === "undefined") return;
      if (!o) localStorage.removeItem(OVERRIDE_KEY);
      else localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
    } catch (e) {
      console.warn("[ChronikenWeather] Override:", e);
    }
  }

  function stateFromOverride(o, cfg) {
    cfg = cfg || loadConfig();
    return {
      slot: "override",
      name: o.name,
      icon: o.icon || "🌤️",
      description: o.description || "",
      weight: o.weight || 0,
      changedAt: new Date(o.startedAt || Date.now()).toISOString(),
      intervalHours: cfg.intervalHours,
      forced: true,
      until: o.until
    };
  }

  function getWeatherState(s, cfg) {
    cfg = cfg || loadConfig();
    var list = (cfg.weather && cfg.weather.length) ? cfg.weather : getFileConfig().weather;
    var w = pickWeighted(s, list);
    var ms = slotMs(cfg);
    return {
      slot: s,
      name: w.name,
      icon: w.icon,
      description: w.description,
      weight: w.weight,
      changedAt: new Date(s * ms).toISOString(),
      intervalHours: cfg.intervalHours,
      forced: false
    };
  }

  function get() {
    var cfg = loadConfig();
    var o = readOverride();
    if (o) return stateFromOverride(o, cfg);
    return getWeatherState(currentSlot(cfg), cfg);
  }

  function msNext() {
    var o = readOverride();
    if (o) return Math.max(0, Number(o.until) - Date.now());
    var cfg = loadConfig();
    var ms = slotMs(cfg);
    return ms - (Date.now() % ms);
  }

  function format(ms) {
    var total = Math.max(0, Math.floor(Number(ms) / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (
      String(h).padStart(2, "0") + ":" +
      String(m).padStart(2, "0") + ":" +
      String(s).padStart(2, "0")
    );
  }

  function nextChangeTime() {
    return new Date(Date.now() + msNext());
  }

  var lastSlot = null;
  var lastForcedUntil = null;

  function emitChange(state) {
    state = state || get();
    try {
      if (typeof window !== "undefined" && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent("chroniken-weather-changed", { detail: state }));
      }
    } catch (e) {}
  }

  function saveConfig(cfg) {
    var clean = normalizeConfig(cfg || {});
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      }
    } catch (e) {
      console.warn("[ChronikenWeather] speichern fehlgeschlagen:", e);
    }
    emitChange(get());
    return clean;
  }

  function clearLocalConfig() {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    emitChange(get());
    return getFileConfig();
  }

  function exportConfigJs(cfg) {
    cfg = normalizeConfig(cfg || loadConfig());
    var lines = cfg.weather.map(function (w) {
      return (
        "      { name: " + JSON.stringify(w.name) +
        ", icon: " + JSON.stringify(w.icon) +
        ", description: " + JSON.stringify(w.description) +
        ", weight: " + w.weight + " }"
      );
    });
    return [
      "/** Chroniken – Wetter-Config (aus Admin exportiert) */",
      "(function (root) {",
      '  "use strict";',
      "  var WEATHER_CONFIG = {",
      "    intervalHours: " + cfg.intervalHours + ",",
      "    weather: [",
      lines.join(",\n"),
      "    ]",
      "  };",
      '  if (typeof root !== "undefined") root.CHRONIKEN_WEATHER_CONFIG = WEATHER_CONFIG;',
      '  if (typeof module !== "undefined" && module.exports) module.exports = WEATHER_CONFIG;',
      '})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);',
      ""
    ].join("\n");
  }

  function forceWeather(w) {
    var cfg = loadConfig();
    var ms = slotMs(cfg);
    var now = Date.now();
    var entry = {
      name: String((w && w.name) || "Unbekannt"),
      icon: String((w && w.icon) || "🌤️"),
      description: String((w && w.description) || ""),
      weight: Math.max(0, Number(w && w.weight) || 0),
      startedAt: now,
      until: now + ms
    };
    writeOverride(entry);
    lastForcedUntil = entry.until;
    lastSlot = null;
    var state = stateFromOverride(entry, cfg);
    emitChange(state);
    return state;
  }

  function skipWeather() {
    var cfg = loadConfig();
    var cur = get();
    return forceWeather(pickRandom(cfg.weather, cur && cur.name));
  }

  function resetTimer() {
    var cur = get();
    return forceWeather({
      name: cur.name,
      icon: cur.icon,
      description: cur.description,
      weight: cur.weight
    });
  }

  function clearOverride() {
    writeOverride(null);
    lastForcedUntil = null;
    var cfg = loadConfig();
    lastSlot = currentSlot(cfg);
    var state = getWeatherState(lastSlot, cfg);
    emitChange(state);
    return state;
  }

  function watch() {
    var cfg = loadConfig();
    var o = readOverride();
    if (o) {
      lastForcedUntil = o.until;
      return;
    }
    if (lastForcedUntil !== null) {
      lastForcedUntil = null;
      lastSlot = currentSlot(cfg);
      emitChange(getWeatherState(lastSlot, cfg));
      return;
    }
    var current = currentSlot(cfg);
    if (lastSlot === null) {
      lastSlot = current;
      return;
    }
    if (current !== lastSlot) {
      lastSlot = current;
      emitChange(getWeatherState(current, cfg));
    }
  }

  if (typeof setInterval !== "undefined") {
    setInterval(watch, 1000);
  }

  var api = {
    get: get,
    getWeatherState: function (s) {
      var cfg = loadConfig();
      var o = readOverride();
      if (o && (s == null || s === undefined)) return stateFromOverride(o, cfg);
      return getWeatherState(s == null ? currentSlot(cfg) : s, cfg);
    },
    msNext: msNext,
    format: format,
    nextChangeTime: nextChangeTime,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    clearLocalConfig: clearLocalConfig,
    exportConfigJs: exportConfigJs,
    getFileConfig: getFileConfig,
    getWeatherList: function () { return loadConfig().weather; },
    forceWeather: forceWeather,
    skipWeather: skipWeather,
    resetTimer: resetTimer,
    clearOverride: clearOverride,
    DEFAULT_CONFIG: getFileConfig(),
    STORAGE_KEY: STORAGE_KEY,
    OVERRIDE_KEY: OVERRIDE_KEY
  };

  if (typeof window !== "undefined") {
    window.ChronikenWeather = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
