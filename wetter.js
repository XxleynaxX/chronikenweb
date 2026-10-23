/**
 * Chroniken Wetter
 * - Liest Wetterlagen aus wetter-data.json (Quelle für Website + GitHub Actions)
 * - optional: localStorage "wetter" (Admin-Änderungen in wetter.html) überschreibt lokal
 * - Das Wetter wird für jeden 6-Stunden-Slot zufällig bestimmt.
 * - Die Zufallsauswahl ist für Website und Discord synchron, damit beide dasselbe Wetter zeigen.
 */
(function () {
  const KEY = "chroniken_weather_state_v1";
  const LIST_KEY = "wetter";
  const SLOT_MS = 6 * 60 * 60 * 1000;
  const DATA_URL = "wetter-data.json";

  const DEFAULT_WEATHER = [
    ["Klarer Himmel", "☀️", "Ein ruhiger, heller Tag liegt über dem Land."],
    ["Leichter Wind", "🍃", "Ein sanfter Wind zieht durch Wälder und Gassen."],
    ["Bewölkt", "☁️", "Wolken ziehen über den Himmel, doch es bleibt trocken."],
    ["Nebel", "🌫️", "Dichter Nebel liegt über dem Land und verschluckt die Ferne."],
    ["Leichter Regen", "🌦️", "Feiner Regen fällt und lässt die Straßen glänzen."],
    ["Starker Regen", "🌧️", "Kräftiger Regen prasselt auf Dächer und Wege."],
    ["Gewitter", "⛈️", "Donner grollt am Horizont und Blitze erhellen die Wolken."],
    ["Starker Wind", "🌬️", "Böen ziehen durch das Land und lassen Äste rauschen."],
    ["Schneefall", "🌨️", "Leiser Schnee fällt vom Himmel und bedeckt die Landschaft."],
    ["Starker Schneefall", "❄️", "Dichter Schnee fällt und macht Wege langsam schwer passierbar."],
    ["Frost", "🥶", "Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft."],
    ["Dunstiger Morgen", "🌤️", "Heller Dunst liegt über dem Land und löst sich langsam auf."]
  ];

  /** @type {Array<[string,string,string]>} */
  let cachedList = null;
  let loadPromise = null;

  function toTuples(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const out = list
      .filter((w) => w && (w.name || (Array.isArray(w) && w[0])))
      .map((w) => {
        if (Array.isArray(w)) return [String(w[0]), String(w[1] || "🌦️"), String(w[2] || "")];
        return [String(w.name), String(w.icon || "🌦️"), String(w.description || "")];
      });
    return out.length ? out : null;
  }

  function getWeatherListSync() {
    // 1) Admin-Liste aus wetter.html (localStorage)
    try {
      const x = JSON.parse(localStorage.getItem(LIST_KEY) || "null");
      const t = toTuples(x);
      if (t) return t;
    } catch {}

    // 2) Aus wetter-data.json (bereits geladen)
    if (cachedList && cachedList.length) return cachedList;

    // 3) Fallback Defaults (identisch zu wetter-data.json / GitHub)
    return DEFAULT_WEATHER.slice();
  }

  function loadWeatherData() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(DATA_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = data && (data.wetter || data);
        const t = toTuples(list);
        if (t) cachedList = t;
        return getWeatherListSync();
      })
      .catch(() => getWeatherListSync());
    return loadPromise;
  }

  function slot() {
    return Math.floor(Date.now() / SLOT_MS);
  }

  /**
   * Zufällige Wetterauswahl pro 6-Stunden-Slot.
   *
   * Der Slot dient als Zufalls-Seed. Dadurch wird das Wetter wirklich
   * zufällig gewählt, bleibt aber auf allen Geräten und in Discord
   * synchron. Derselbe Slot liefert überall dasselbe Wetter.
   *
   * Zusätzlich wird verhindert, dass direkt zweimal hintereinander
   * dieselbe Wetterlage erscheint.
   */
  function randomIndex(seed, length) {
    let x = (seed * 1664525 + 1013904223) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    return x % length;
  }

  function pick(s, list) {
    const WEATHER = list && list.length ? list : getWeatherListSync();
    if (WEATHER.length === 1) return WEATHER[0];

    let index = randomIndex(s, WEATHER.length);

    // Keine identische Wetterlage in zwei aufeinanderfolgenden Slots.
    const previousIndex = randomIndex(s - 1, WEATHER.length);
    if (index === previousIndex) {
      index = (index + 1 + randomIndex(s + 17, WEATHER.length - 1)) % WEATHER.length;
    }

    return WEATHER[index];
  }

  function get() {
    const s = slot();
    const w = pick(s);
    const prev = JSON.parse(localStorage.getItem(KEY) || "null");
    const state = {
      slot: s,
      name: w[0],
      icon: w[1],
      description: w[2],
      changedAt: new Date(s * SLOT_MS).toISOString()
    };
    if (!prev || prev.slot !== s) localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }

  function msNext() {
    return SLOT_MS - (Date.now() % SLOT_MS);
  }

  function format(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return (
      String(h).padStart(2, "0") +
      ":" +
      String(m).padStart(2, "0") +
      ":" +
      String(s).padStart(2, "0")
    );
  }

  function replaceVars(text, w) {
    const now = new Date();
    const next = format(msNext());
    const vars = {
      wetter: w.name,
      wetter_icon: w.icon,
      wetter_beschreibung: w.description,
      naechster_wetterwechsel: next,
      datum: now.toLocaleDateString("de-DE"),
      zeit: now.toLocaleTimeString("de-DE")
    };
    return String(text || "").replace(/%([a-zA-Z0-9_]+)%/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : "%" + k + "%"
    );
  }

  function getWeatherTemplate() {
    try {
      const all = JSON.parse(localStorage.getItem("chroniken_webhook_templates") || "{}");
      return (
        all.wetter || {
          title: "🌦️ Wetter in Chroniken",
          text:
            "%wetter% ist jetzt bei Chroniken.\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%"
        }
      );
    } catch {
      return {
        title: "🌦️ Wetter in Chroniken",
        text:
          "%wetter% ist jetzt bei Chroniken.\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%"
      };
    }
  }

  /**
   * Optionaler Browser-Notify (nur wenn Webhook noch lokal hinterlegt ist).
   * Primärer Discord-Weg: GitHub Actions → weather-notify.js
   */
  async function notifyIfChanged() {
    const s = slot();
    const marker = "chroniken_weather_notified_slot_v1";
    const last = localStorage.getItem(marker);
    if (String(last) === String(s)) return true;

    let all = {};
    try {
      all = JSON.parse(localStorage.getItem("chroniken_discord_webhooks") || "{}");
    } catch {}
    const data = all.wetter || null;
    const url = data && data.url ? data.url : "";
    if (!url) return true;

    await loadWeatherData();
    const w = get();
    const tpl = getWeatherTemplate();
    try {
      const title = replaceVars(tpl.title, w);
      const description = replaceVars(tpl.text, w);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Chroniken Wetter",
          embeds: [
            {
              title,
              description,
              color: 0x7c3aed,
              footer: { text: "Chroniken · Wetter" },
              timestamp: new Date().toISOString()
            }
          ]
        })
      });
      if (res.ok) localStorage.setItem(marker, String(s));
      return res.ok;
    } catch {
      return false;
    }
  }

  // Früh laden, damit pick() möglichst bald die JSON-Liste nutzt
  loadWeatherData().then(() => {
    get();
    notifyIfChanged();
  });

  window.ChronikenWeather = {
    get,
    msNext,
    format,
    notifyIfChanged,
    getWeatherList: getWeatherListSync,
    loadWeatherData,
    SLOT_MS,
    get WEATHER() {
      return getWeatherListSync();
    }
  };

  // Sofortigen Zustand aus Sync-Liste setzen (Defaults / localStorage)
  get();
})();
