/* ============================================================
   Chroniken – Events / News / Geburtstage zentral in JSONBin

   Eigener Bin (nur Events): EVENTS_BIN_ID
   localStorage bleibt als schneller Cache (portal_events,
   portal_birthdays), JSONBin ist die gemeinsame Wahrheit.
   Einbinden:  <script src="chroniken-sync.js"></script>
   Optional:   data-reload-on-change  → Seite lädt neu, wenn
               sich beim Sync etwas geändert hat.
   ============================================================ */
(function (global) {
  const EVENTS_BIN_ID = "6ae18121ffd5d1605391c7c7";
  const MASTER_KEY = "$2a$10$UtTY0igLD.IvUKF5WDV89uC7/zf7h2HP3R3jXC/mghWJDo20hRpqO";
  const API = "https://api.jsonbin.io/v3/b/" + EVENTS_BIN_ID;

  const LS = { events: "portal_events", birthdays: "portal_birthdays", calendar: "chroniken_calendar_entries", disabledHolidays: "chroniken_disabled_holidays", weather: "chroniken_weather_events_bin" };
  const KEYS = Object.keys(LS);
  const AUTH_KEY = "portal_admin_auth";

  const script = document.currentScript;
  const reloadOnChange = !!(script && script.hasAttribute("data-reload-on-change"));

  function isAdmin() {
    try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
  }
  function readLocal(name) {
    try { const v = JSON.parse(localStorage.getItem(LS[name]) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function writeLocal(name, arr) {
    try { localStorage.setItem(LS[name], JSON.stringify(arr)); } catch (e) {}
  }

  async function fetchRemote() {
    const res = await fetch(API + "/latest", { headers: { "X-Master-Key": MASTER_KEY, "X-Bin-Meta": "false" } });
    if (!res.ok) throw new Error("JSONBin lesen fehlgeschlagen: " + res.status);
    const data = await res.json();
    const rec = (data && data.record !== undefined) ? data.record : data;
    return (rec && typeof rec === "object") ? rec : {};
  }
  async function putRemote(record) {
    const res = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": MASTER_KEY },
      body: JSON.stringify(record)
    });
    if (!res.ok) throw new Error("JSONBin speichern fehlgeschlagen: " + res.status);
    return res.json();
  }

  function emit(changed) {
    try { document.dispatchEvent(new CustomEvent("chroniken-synced", { detail: { changed: !!changed } })); } catch (e) {}
  }

  /** Holt den Bin und überschreibt den lokalen Cache. */
  async function pull() {
    const rec = await fetchRemote();
    let changed = false;
    let needsMigration = false;
    KEYS.forEach(function (name) {
      if (Array.isArray(rec[name])) {
        const before = localStorage.getItem(LS[name]);
        const after = JSON.stringify(rec[name]);
        if (before !== after) { writeLocal(name, rec[name]); changed = true; }
      } else if (readLocal(name).length) {
        needsMigration = true;
      }
    });
    // Erster Start: lokale Daten eines Admins in den leeren Bin übernehmen
    if (needsMigration && isAdmin()) {
      const next = {};
      KEYS.forEach(function (k) { next[k] = Array.isArray(rec[k]) ? rec[k] : readLocal(k); });
      await putRemote(Object.assign({}, rec, next));
    }
    emit(changed);
    if (changed && reloadOnChange) location.reload();
    return changed;
  }

  /**
   * Sicherer Schreibzugriff: frisch lesen → ändern → speichern.
   * fns = { events: arr => newArr, birthdays: arr => newArr }
   */
  let queue = Promise.resolve();
  function mutate(fns) {
    const run = queue.then(function () { return doMutate(fns); });
    queue = run.catch(function () {});
    return run;
  }
  async function doMutate(fns) {
    let rec;
    try { rec = await fetchRemote(); }
    catch (e) { rec = {}; throw e; }
    const next = Object.assign({}, rec);
    KEYS.forEach(function (k) { next[k] = Array.isArray(rec[k]) ? rec[k] : readLocal(k); });
    Object.keys(fns).forEach(function (k) {
      const out = fns[k](next[k].slice());
      next[k] = Array.isArray(out) ? out : next[k];
    });
    await putRemote(next);
    KEYS.forEach(function (k) { writeLocal(k, next[k]); });
    emit(true);
    return next;
  }

  // ---------- Events ----------
  function newId() { return "e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7); }

  async function saveEvent(data, editingId) {
    const now = Date.now();
    let saved = null, wasEdit = false;
    await mutate({
      events: function (list) {
        if (editingId) {
          const t = list.find(function (x) { return x.id === editingId; });
          if (t) { Object.assign(t, data, { updated: now }); saved = t; wasEdit = true; return list; }
        }
        saved = Object.assign({ id: newId(), created: now, updated: now }, data);
        list.push(saved);
        return list;
      }
    });
    return saved;
  }

  async function removeEvent(id) {
    let removed = null;
    await mutate({
      events: function (list) {
        removed = list.find(function (x) { return x.id === id; }) || null;
        return list.filter(function (x) { return x.id !== id; });
      }
    });
    if (removed && removed.eventType === "Geburtstag" && removed.characterName) {
      await removeBirthday(removed.characterName, true);
    }
    return removed;
  }

  // ---------- Geburtstage ----------
  async function removeBirthday(name, silent) {
    let removedEv = null;
    await mutate({
      birthdays: function (list) { return list.filter(function (b) { return b.name !== name; }); },
      events: function (list) {
        removedEv = list.find(function (e) { return e.eventType === "Geburtstag" && e.characterName === name; }) || null;
        return list.filter(function (e) { return !(e.eventType === "Geburtstag" && e.characterName === name); });
      }
    });
  }

  async function saveBirthday(oldName, b) {
    const now = Date.now();
    const months = ["Frostmond","Eismond","Tauwind","Blütenmond","Sonnenhain","Glutmond","Erntemond","Goldlaub","Nebelmond","Dunkelmond","Sternenfall","Nachtfrost"];
    const monthName = months[b.month] || "";
    const date = b.day + ". " + monthName + (b.year ? " " + b.year : "");
    await mutate({
      birthdays: function (list) {
        return list.filter(function (x) { return x.name !== oldName && x.name !== b.name; })
          .concat([{ name: b.name, day: b.day, month: b.month, year: b.year, monthName: monthName, updated: now }]);
      },
      events: function (list) {
        const old = list.find(function (e) { return e.eventType === "Geburtstag" && e.characterName === oldName; });
        const rest = list.filter(function (e) { return !(e.eventType === "Geburtstag" && (e.characterName === oldName || e.characterName === b.name)); });
        rest.push(Object.assign({}, old || { id: newId(), content: "Automatisch aus dem Charakterbogen erstellt.", showInNews: true, created: now, eventType: "Geburtstag" }, {
          characterName: b.name, title: "🎂 Geburtstag von " + b.name, date: date,
          birthdayDay: b.day, birthdayMonth: b.month, birthdayYear: b.year, updated: now
        }));
        return rest;
      }
    });
  }

  /** Vom Charakterbogen: Eintrag(e) im Bin ersetzen (fail-silent, lokal ist schon gespeichert). */
  async function upsertCharacter(eventObj, birthdayObj) {
    try {
      await mutate({
        events: function (list) {
          if (!eventObj) return list;
          return list.filter(function (e) {
            return e.characterEventId !== eventObj.characterEventId && e.characterName !== eventObj.characterName;
          }).concat([eventObj]);
        },
        birthdays: function (list) {
          if (!birthdayObj) return list;
          return list.filter(function (b) { return b.name !== birthdayObj.name; }).concat([birthdayObj]);
        }
      });
      return true;
    } catch (e) { console.warn("[Chroniken-Sync]", e); return false; }
  }

  // ---------- Kalender / ausgeblendete Feiertage (liegen im Events-Bin) ----------
  // Ältere Einträge aus dem Haupt-Bin (ChronikenStorage) werden angezeigt, bis
  // zum ersten Speichern, und dann in den Events-Bin übernommen.
  async function legacyLoad(name) {
    try {
      if (!global.ChronikenStorage) return [];
      const old = await global.ChronikenStorage.load(name);
      return Array.isArray(old) ? old : [];
    } catch (e) { return []; }
  }
  async function loadShared(name) {
    let list;
    try {
      const rec = await fetchRemote();
      list = Array.isArray(rec[name]) ? rec[name] : [];
      writeLocal(name, list);
    } catch (e) {
      console.warn("[Chroniken-Sync]", e);
      list = readLocal(name);
    }
    if (!list.length) {
      const old = await legacyLoad(name);
      if (old.length) return old;
    }
    return list;
  }
  async function saveShared(name, list) {
    const value = Array.isArray(list) ? list : [];
    const fns = {};
    fns[name] = function () { return value; };
    await mutate(fns);
    const old = await legacyLoad(name);
    if (old.length) {
      try { await global.ChronikenStorage.save(name, []); } catch (e) { console.warn("[Chroniken-Sync]", e); }
    }
    return value;
  }

  global.ChronikenSync = {
    EVENTS_BIN_ID: EVENTS_BIN_ID,
    isAdmin: isAdmin,
    pull: pull,
    load: readLocal,
    saveEvent: saveEvent,
    removeEvent: removeEvent,
    saveBirthday: saveBirthday,
    removeBirthday: removeBirthday,
    upsertCharacter: upsertCharacter,
    loadShared: loadShared,
    saveShared: saveShared,
    saveCalendar: function (list) { return saveShared("calendar", list); },
    saveDisabledHolidays: function (list) { return saveShared("disabledHolidays", list); },
    loadWeather: function () { return loadShared("weather"); },
    saveWeather: function (state) { return saveShared("weather", [state]); },
    /** Lokale Daten komplett in den Bin schreiben (Admin-Button). */
    async pushLocal() {
      let rec = {};
      try { rec = await fetchRemote(); } catch (e) {}
      const all = {};
      KEYS.forEach(function (k) { all[k] = readLocal(k); });
      await putRemote(Object.assign({}, rec, all));
      emit(true);
    }
  };

  function start() { pull().catch(function (e) { console.warn("[Chroniken-Sync]", e); emit(false); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
