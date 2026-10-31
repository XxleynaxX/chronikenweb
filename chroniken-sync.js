/* ============================================================
   Chroniken – Zentrale Datenspeicherung direkt in Supabase

   Die Webseite liest und speichert die gemeinsamen Chroniken-Daten
   direkt in Supabase. Supabase und Render werden dafür nicht benötigt.

   WICHTIG:
   Nur den Supabase Publishable Key verwenden. Niemals einen
   Supabase Secret Key in diese Datei oder eine andere Browser-Datei
   eintragen.
   ============================================================ */
(function (global) {
  const SUPABASE_URL = "https://wlrsluafjhaeurgmqmci.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__kXmLDeP47mcg-ytidwTg_ktUyr1mm";
  const EVENTS_BIN_ID = "supabase";
  const CHARS_BIN_ID = "supabase";
  const BIN_OF = { events: "main", birthdays: "main", calendar: "main", disabledHolidays: "main", characters: "chars", characterSheets: "chars" };\n  const DB_KEY_OF = { events: "events", birthdays: "birthdays", calendar: "calendar", disabledHolidays: "disabledHolidays", characters: "characters", characterSheets: "character_sheets" };

  const LS = { events: "portal_events", birthdays: "portal_birthdays", calendar: "chroniken_calendar_entries", disabledHolidays: "chroniken_disabled_holidays", characters: "portal_char_registry", characterSheets: "portal_char_sheets" };
  const KEYS = Object.keys(LS);
  const BIN_KEYS = {
    main: KEYS.filter(function (k) { return BIN_OF[k] === "main"; }),
    chars: KEYS.filter(function (k) { return BIN_OF[k] === "chars"; })
  };
  const AUTH_KEY = "portal_admin_auth";
  let supabase = null;
  let supabaseReady = null;

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

  function initSupabase() {
    if (supabase) return Promise.resolve(supabase);
    if (supabaseReady) return supabaseReady;
    if (!SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.indexOf("HIER_DEIN_") === 0) {
      return Promise.reject(new Error("Supabase Publishable Key fehlt in chroniken-sync.js"));
    }
    supabaseReady = new Promise(function (resolve, reject) {
      function ready() {
        if (!global.supabase || !global.supabase.createClient) {
          reject(new Error("Supabase JS konnte nicht geladen werden."));
          return;
        }
        supabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        resolve(supabase);
      }
      if (global.supabase && global.supabase.createClient) {
        ready();
        return;
      }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = ready;
      s.onerror = function () { reject(new Error("Supabase JS konnte nicht geladen werden.")); };
      document.head.appendChild(s);
    });
    return supabaseReady;
  }

  async function fetchRemote() {
    const client = await initSupabase();
    const { data, error } = await client.from("chroniken_data").select("key,value");
    if (error) throw new Error("Supabase lesen fehlgeschlagen: " + error.message);
    const out = {};
    (data || []).forEach(function (row) {
      const logical = Object.keys(DB_KEY_OF).find(function (k) { return DB_KEY_OF[k] === row.key; });
      if (logical) out[logical] = Array.isArray(row.value) ? row.value : [];
      else out[row.key] = Array.isArray(row.value) ? row.value : row.value;
    });
    return out;
  }

  async function putRemote(record, bin) {
    const client = await initSupabase();
    const keys = BIN_KEYS[bin || "main"];
    const rows = keys.map(function (k) {
      return {
        key: DB_KEY_OF[k] || k,
        value: Array.isArray(record[k]) ? record[k] : [],
        updated_at: new Date().toISOString()
      };
    });
    const { error } = await client.from("chroniken_data").upsert(rows, { onConflict: "key" });
    if (error) throw new Error("Supabase speichern fehlgeschlagen: " + error.message);
    return { ok: true };
  }

  async function fillCharRecord(rec, allowLocal) {
    let legacy = null, filled = false;
    for (const k of BIN_KEYS.chars) {
      if (Array.isArray(rec[k])) continue;
      if (legacy === null) { try { legacy = await fetchRemote(); } catch (e) { legacy = {}; } }
      if (Array.isArray(legacy[k]) && legacy[k].length) { rec[k] = legacy[k]; filled = true; }
      else if (allowLocal && readLocal(k).length) { rec[k] = readLocal(k); filled = true; }
      else rec[k] = [];
    }
    return filled;
  }

  function emit(changed) {
    try { document.dispatchEvent(new CustomEvent("chroniken-synced", { detail: { changed: !!changed } })); } catch (e) {}
  }

  /** Charakter-Bin: fehlen dort Listen, werden sie aus dem alten Events-Bin (oder lokal) übernommen. */
  async function fillCharRecord(rec, allowLocal) {
    let legacy = null, filled = false;
    for (const k of BIN_KEYS.chars) {
      if (Array.isArray(rec[k])) continue;
      if (legacy === null) { try { legacy = await fetchRemote(); } catch (e) { legacy = {}; } }
      if (Array.isArray(legacy[k]) && legacy[k].length) { rec[k] = legacy[k]; filled = true; }
      else if (allowLocal && readLocal(k).length) { rec[k] = readLocal(k); filled = true; }
      else rec[k] = [];
    }
    return filled;
  }

  /** Holt die Bins und überschreibt den lokalen Cache. */
  async function pull() {
    let changed = false;
    const apply = function (name, arr) {
      const before = localStorage.getItem(LS[name]);
      if (before !== JSON.stringify(arr)) { writeLocal(name, arr); changed = true; }
    };

    // --- Events-Bin ---
    const rec = await fetchRemote();
    let needsMigration = false;
    BIN_KEYS.main.forEach(function (name) {
      if (Array.isArray(rec[name])) apply(name, rec[name]);
      else if (readLocal(name).length) needsMigration = true;
    });
    // Erster Start: lokale Daten eines Admins in den leeren Bin übernehmen
    if (needsMigration && isAdmin()) {
      const next = {};
      BIN_KEYS.main.forEach(function (k) { next[k] = Array.isArray(rec[k]) ? rec[k] : readLocal(k); });
      await putRemote(Object.assign({}, rec, next), "main");
    }

    // --- Charakter-Bin ---
    try {
      const crec = await fetchRemote();
      const hadAll = BIN_KEYS.chars.every(function (k) { return Array.isArray(crec[k]); });
      const filled = hadAll ? false : await fillCharRecord(crec, isAdmin());
      BIN_KEYS.chars.forEach(function (name) { apply(name, crec[name]); });
      if (filled) await putRemote(crec, "chars");
    } catch (e) { console.warn("[Chroniken-Sync] Charakter-Bin:", e); }

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
    const names = Object.keys(fns);
    const bins = ["main", "chars"].filter(function (b) {
      return names.some(function (n) { return BIN_OF[n] === b; });
    });
    let last = null;
    for (const bin of bins) {
      const rec = await fetchRemote();
      const next = Object.assign({}, rec);
      if (bin === "chars") await fillCharRecord(next, true);
      else BIN_KEYS.main.forEach(function (k) { next[k] = Array.isArray(rec[k]) ? rec[k] : readLocal(k); });
      names.filter(function (n) { return BIN_OF[n] === bin; }).forEach(function (k) {
        const out = fns[k](next[k].slice());
        next[k] = Array.isArray(out) ? out : next[k];
      });
      await putRemote(next, bin);
      BIN_KEYS[bin].forEach(function (k) { writeLocal(k, next[k]); });
      last = next;
    }
    emit(true);
    return last;
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
      if (BIN_OF[name] === "chars" && !Array.isArray(rec[name])) list = (await fetchRemote())[name] || [];
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


  // ---------- Charakter-Verwaltung (gemeinsam für Spieler & Admins) ----------
  function charIdNum(id) { const m = /^CH-(\d+)$/.exec(String(id || "")); return m ? parseInt(m[1], 10) : 0; }
  function nextCharId(list) {
    let n = 0;
    list.forEach(function (c) { n = Math.max(n, charIdNum(c.id)); });
    return "CH-" + String(n + 1).padStart(4, "0");
  }
  function sameName(a, b) { return String(a.name || "").trim().toLowerCase() === String(b.name || "").trim().toLowerCase(); }

  // Leere Felder weglassen, damit die Kopie im Bin klein bleibt
  function compactSheet(d) {
    const out = {};
    Object.keys(d || {}).forEach(function (k) {
      const v = d[k];
      if (v === "" || v === false || v == null || (Array.isArray(v) && !v.length)) return;
      out[k] = v;
    });
    return out;
  }
  function putSheet(list, id, name, data) {
    const rec = { id: id, name: name, savedAt: new Date().toISOString(), data: compactSheet(data) };
    const i = list.findIndex(function (x) { return x.id === id; });
    if (i >= 0) list[i] = rec; else list.push(rec);
    return list;
  }

  /** Vom Charakterbogen: Eintrag anlegen oder aktualisieren. Die ID wird frisch vergeben,
   *  damit sich Einträge verschiedener Spieler nie überschneiden. Admin-Felder bleiben erhalten. */
  async function upsertRegistryEntry(entry) {
    const slim = Object.assign({}, entry);
    const sheetData = slim.characterData;
    delete slim.characterData;
    let result = null;
    await mutate({
      characters: function (list) {
        let i = list.findIndex(function (c) { return c.id === slim.id && sameName(c, slim); });
        if (i < 0) i = list.findIndex(function (c) {
          return sameName(c, slim) && (!slim.steamId || String(c.steamId || "").trim() === String(slim.steamId).trim());
        });
        if (i >= 0) {
          const old = list[i];
          list[i] = Object.assign({}, old, slim, {
            id: old.id, createdAt: old.createdAt || slim.createdAt,
            status: old.status || slim.status, warnings: old.warnings,
            violation: old.violation, notes: old.notes
          });
          result = list[i];
        } else {
          slim.id = nextCharId(list);
          list.push(slim);
          result = slim;
        }
        return list;
      },
      characterSheets: function (list) {
        return result && sheetData ? putSheet(list, result.id, result.name, sheetData) : list;
      }
    });
    return result;
  }

  /** Admin: neuen Eintrag anlegen (ID wird frisch vergeben). */
  async function addCharacter(payload) {
    let result = null;
    await mutate({
      characters: function (list) {
        result = Object.assign({ id: nextCharId(list), createdAt: new Date().toISOString() }, payload);
        list.push(result);
        return list;
      }
    });
    return result;
  }

  /** Admin: bestehenden Eintrag ersetzen. */
  async function saveCharacter(rec) {
    await mutate({
      characters: function (list) {
        const i = list.findIndex(function (c) { return c.id === rec.id; });
        if (i >= 0) list[i] = rec; else list.push(rec);
        return list;
      }
    });
    return rec;
  }

  async function removeCharacter(id) {
    await mutate({
      characters: function (list) { return list.filter(function (c) { return c.id !== id; }); },
      characterSheets: function (list) { return list.filter(function (x) { return x.id !== id; }); }
    });
  }

  /** Admin: ältere Einträge mit eingebetteten Bogen-Daten in die Kopien-Liste überführen. */
  async function migrateEmbeddedSheets() {
    if (!readLocal("characters").some(function (c) { return c.characterData; })) return;
    const pending = [];
    await mutate({
      characters: function (list) {
        return list.map(function (c) {
          if (!c.characterData) return c;
          pending.push(c);
          const copy = Object.assign({}, c); delete copy.characterData; return copy;
        });
      },
      characterSheets: function (list) {
        pending.forEach(function (c) {
          if (!list.some(function (x) { return x.id === c.id; })) putSheet(list, c.id, c.name, c.characterData);
        });
        return list;
      }
    });
  }

  global.ChronikenSync = {
    upsertRegistryEntry: upsertRegistryEntry,
    addCharacter: addCharacter,
    saveCharacter: saveCharacter,
    removeCharacter: removeCharacter,
    EVENTS_BIN_ID: EVENTS_BIN_ID,
    CHARS_BIN_ID: CHARS_BIN_ID,
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
    /** Lokale Daten komplett in den Bin schreiben (Admin-Button). */
    async pushLocal() {
      for (const bin of ["main", "chars"]) {
        let rec = {};
        try { rec = await fetchRemote(); } catch (e) {}
        const all = {};
        BIN_KEYS[bin].forEach(function (k) { all[k] = readLocal(k); });
        await putRemote(Object.assign({}, rec, all), bin);
      }
      emit(true);
    }
  };

  function start() { pull().then(function () { if (isAdmin()) return migrateEmbeddedSheets(); }).catch(function (e) { console.warn("[Chroniken-Sync]", e); emit(false); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
