(function () {
  const STORAGE_KEY = "chroniken_weather_config";
  const LAST_NOTIFY_KEY = "chroniken_weather_last_notify_slot";

  const DEFAULT_WEATHER = [
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
  ];

  const DEFAULT_CONFIG = {
    intervalHours: 6,
    discordEnabled: false,
    discordWebhook: "",
    weather: DEFAULT_WEATHER.map(function (w) { return Object.assign({}, w); })
  };

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.weather) || !parsed.weather.length) {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }
      return {
        intervalHours: Math.max(1, Number(parsed.intervalHours) || 6),
        discordEnabled: !!parsed.discordEnabled,
        discordWebhook: String(parsed.discordWebhook || ""),
        weather: parsed.weather.map(function (w) {
          return {
            name: String(w.name || "Unbekannt"),
            icon: String(w.icon || "🌤️"),
            description: String(w.description || ""),
            weight: Math.max(0, Number(w.weight) || 0)
          };
        }).filter(function (w) { return w.weight > 0 || w.name; })
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function saveConfig(cfg) {
    const clean = {
      intervalHours: Math.max(1, Number(cfg.intervalHours) || 6),
      discordEnabled: !!cfg.discordEnabled,
      discordWebhook: String(cfg.discordWebhook || "").trim(),
      weather: (cfg.weather || []).map(function (w) {
        return {
          name: String(w.name || "").trim() || "Unbenannt",
          icon: String(w.icon || "🌤️").trim() || "🌤️",
          description: String(w.description || "").trim(),
          weight: Math.max(0, Number(w.weight) || 0)
        };
      })
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function slotMs(cfg) {
    return (cfg.intervalHours || 6) * 60 * 60 * 1000;
  }

  function currentSlot(cfg) {
    return Math.floor(Date.now() / slotMs(cfg));
  }

  function randomIndex(seed, length) {
    let x = (seed * 1103515245 + 12345) >>> 0;
    x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
    return x % length;
  }

  function pickWeighted(seed, list) {
    const total = list.reduce(function (sum, w) { return sum + Math.max(0, Number(w.weight) || 0); }, 0);
    if (total <= 0) {
      return list[randomIndex(seed, list.length)] || list[0];
    }
    // Deterministic: use seed to pick a point in the weight range
    let r = randomIndex(seed, total);
    for (let i = 0; i < list.length; i++) {
      r -= Math.max(0, Number(list[i].weight) || 0);
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  function getWeatherState(s, cfg) {
    cfg = cfg || loadConfig();
    const list = cfg.weather && cfg.weather.length ? cfg.weather : DEFAULT_WEATHER;
    const w = pickWeighted(s, list);
    const ms = slotMs(cfg);
    return {
      slot: s,
      name: w.name,
      icon: w.icon,
      description: w.description,
      weight: w.weight,
      changedAt: new Date(s * ms).toISOString(),
      intervalHours: cfg.intervalHours
    };
  }

  function get() {
    const cfg = loadConfig();
    return getWeatherState(currentSlot(cfg), cfg);
  }

  function msNext() {
    const cfg = loadConfig();
    const ms = slotMs(cfg);
    return ms - (Date.now() % ms);
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

  function nextChangeTime() {
    return new Date(Date.now() + msNext());
  }

  async function notifyDiscord(state, cfg) {
    if (!cfg.discordEnabled || !cfg.discordWebhook) return;
    try {
      const last = localStorage.getItem(LAST_NOTIFY_KEY);
      if (last === String(state.slot)) return;
      localStorage.setItem(LAST_NOTIFY_KEY, String(state.slot));

      const content =
        "**Wetterwechsel in den Chroniken**\n" +
        state.icon + " **" + state.name + "**\n" +
        state.description + "\n" +
        "_Nächster Wechsel in ca. " + cfg.intervalHours + " Stunden_";

      await fetch(cfg.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content })
      });
    } catch (e) {
      console.warn("Discord Wetter-Notify fehlgeschlagen:", e);
    }
  }

  let lastSlot = null;

  function watch() {
    const cfg = loadConfig();
    const current = currentSlot(cfg);
    if (lastSlot === null) {
      lastSlot = current;
      return;
    }
    if (current !== lastSlot) {
      lastSlot = current;
      const state = getWeatherState(current, cfg);
      window.dispatchEvent(
        new CustomEvent("chroniken-weather-changed", { detail: state })
      );
      notifyDiscord(state, cfg);
    }
  }

  setInterval(watch, 1000);

  // Bei Seitenstart: wenn wir in einem neuen Slot sind und Discord an ist, einmal nachziehen
  (function bootstrapNotify() {
    const cfg = loadConfig();
    if (!cfg.discordEnabled || !cfg.discordWebhook) return;
    const s = currentSlot(cfg);
    const last = localStorage.getItem(LAST_NOTIFY_KEY);
    if (last !== String(s)) {
      notifyDiscord(getWeatherState(s, cfg), cfg);
    }
  })();

  window.ChronikenWeather = {
    get: get,
    getWeatherState: function (s) {
      return getWeatherState(s == null ? currentSlot(loadConfig()) : s, loadConfig());
    },
    msNext: msNext,
    format: format,
    nextChangeTime: nextChangeTime,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    getWeatherList: function () {
      return loadConfig().weather;
    },
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    STORAGE_KEY: STORAGE_KEY
  };
})();
