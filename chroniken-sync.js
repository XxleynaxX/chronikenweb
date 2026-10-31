/* ============================================================
   Chroniken – Events, Charaktere, Kalender über Supabase
   Dünner Layer über ChronikenStorage + localStorage-Cache
   ============================================================
   Keine JSONBin-Reste mehr. Alle Daten laufen über
   ChronikenStorage → Tabelle chroniken_data.
   ============================================================ */
(function (global) {
  "use strict";

  // localStorage-Keys (Cache)
  const LS = {
    events: "portal_events",
    birthdays: "portal_birthdays",
    calendar: "chroniken_calendar_entries",
    disabledHolidays: "chroniken_disabled_holidays",
    characters: "portal_char_registry",
    characterSheets: "portal_char_sheets"
  };

  const KEYS = Object.keys(LS);
  const AUTH_KEY = "portal_admin_auth";

  const script = document.currentScript;
  const reloadOnChange = !!(script && script.hasAttribute("data-reload-on-change"));

  function isAdmin() {
    try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
  }

  function readLocal(name) {
    try {
      const v = JSON.parse(localStorage.getItem(LS[name]) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function writeLocal(name, arr) {
    try { localStorage.setItem(LS[name], JSON.stringify(arr)); } catch (e) {}
  }

  function emit(changed) {
    try {
      document.dispatchEvent(new CustomEvent("chroniken-synced", {
        detail: { changed: !!changed }
      }));
    } catch (e) {}
  }

  // ---------- Remote lesen / schreiben (über ChronikenStorage) ----------
  async function fetchRemote() {
    if (!global.ChronikenStorage) {
      throw new Error("ChronikenStorage ist nicht geladen.");
    }
    const out = {};
    for (const name of KEYS) {
      out[name] = await global.ChronikenStorage.load(name);
    }
    return out;
  }

  async function putRemote(record) {
    if (!global.ChronikenStorage) {
      throw new Error("ChronikenStorage ist nicht geladen.");
    }
    for (const k of KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, k)) {
        const value = Array.isArray(record[k]) ? record[k] : [];
        await global.ChronikenStorage.save(k, value);
      }
    }
    return { ok: true };
  }

  // ---------- Pull: Remote → localStorage ----------
  async function pull() {
    let changed = false;

    const apply = function (name, arr) {
      const before = localStorage.getItem(LS[name]);
      if (before !== JSON.stringify(arr)) {
        writeLocal(name, arr);
        changed = true;
      }
    };

    try {
      const rec = await fetchRemote();
      let needsMigration = false;

      KEYS.forEach(function (name) {
        if (Array.isArray(rec[name])) {
          apply(name, rec[name]);
        } else if (readLocal(name).length) {
          needsMigration = true;
        }
      });

      // Erster Start: lokale Admin-Daten hochladen
      if (needsMigration && isAdmin()) {
        const next = {};
        KEYS.forEach(function (k) {
          next[k] = Array.isArray(rec[k]) ? rec[k] : readLocal(k);
        });
        await putRemote(next);
      }
    } catch (e) {
      console.warn("[Chroniken-Sync] pull:", e);
    }

    emit(changed);
    if (changed && reloadOnChange) location.reload();
    return changed;
  }

  // ---------- Mutate-Queue (read → change → write) ----------
  let queue = Promise.resolve();

  function mutate(fns) {
    const run = queue.then(function () { return doMutate(fns); });
    queue = run.catch(function () {});
    return run;
  }

  async function doMutate(fns) {
    const names = Object.keys(fns);
    let rec = {};
    try {
      rec = await fetchRemote();
    } catch (e) {
      // Fallback auf lokal
      KEYS.forEach(function (k) { rec[k] = readLocal(k); });
    }

    const next = Object.assign({}, rec);
    names.forEach(function (k) {
      const current = Array.isArray(next[k]) ? next[k] : readLocal(k);
      next[k] = fns[k](current.slice());
    });

    names.forEach(function (k) { writeLocal(k, next[k]); });
    await putRemote(next);
    emit(true);
    return next;
  }

  // ---------- Events ----------
  function newId() {
    return "e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  async function saveEvent(data, editingId) {
    const now = Date.now();
    let saved = null;

    await mutate({
      events: function (list) {
        if (editingId) {
          const t = list.find(function (x) { return x.id === editingId; });
          if (t) {
            Object.assign(t, data, { updated: now });
            saved = t;
            return list;
          }
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
    await mutate({
      birthdays: function (list) {
        return list.filter(function (b) { return b.name !== name; });
      },
      events: function (list) {
        return list.filter(function (e) {
          return !(e.eventType === "Geburtstag" && e.characterName === name);
        });
      }
    });
  }

  async function saveBirthday(oldName, b) {
    const now = Date.now();
    const months = [
      "Frostmond", "Eismond", "Tauwind", "Blütenmond", "Sonnenhain", "Glutmond",
      "Erntemond", "Goldlaub", "Nebelmond", "Dunkelmond", "Sternenfall", "Nachtfrost"
    ];
    const monthName = months[b.month] || "";
    const date = b.day + ". " + monthName + (b.year ? " " + b.year : "");

    await mutate({
      birthdays: function (list) {
        return list
          .filter(function (x) { return x.name !== oldName && x.name !== b.name; })
          .concat([{
            name: b.name,
            day: b.day,
            month: b.month,
            year: b.year,
            monthName: monthName,
            updated: now
          }]);
      },
      events: function (list) {
        const old = list.find(function (e) {
          return e.eventType === "Geburtstag" && e.characterName === oldName;
        });
        const rest = list.filter(function (e) {
          return !(e.eventType === "Geburtstag" &&
            (e.characterName === oldName || e.characterName === b.name));
        });
        rest.push(Object.assign(
          {},
          old || {
            id: newId(),
            content: "Automatisch aus dem Charakterbogen erstellt.",
            showInNews: true,
            created: now,
            eventType: "Geburtstag"
          },
          {
            characterName: b.name,
            title: "🎂 Geburtstag von " + b.name,
            date: date,
            birthdayDay: b.day,
            birthdayMonth: b.month,
            birthdayYear: b.year,
            updated: now
          }
        ));
        return rest;
      }
    });
  }

  /** Vom Charakterbogen: Event + Geburtstag ersetzen (fail-silent). */
  async function upsertCharacter(eventObj, birthdayObj) {
    try {
      await mutate({
        events: function (list) {
          if (!eventObj) return list;
          return list
            .filter(function (e) {
              return e.characterEventId !== eventObj.characterEventId &&
                     e.characterName !== eventObj.characterName;
            })
            .concat([eventObj]);
        },
        birthdays: function (list) {
          if (!birthdayObj) return list;
          return list
            .filter(function (b) { return b.name !== birthdayObj.name; })
            .concat([birthdayObj]);
        }
      });
      return true;
    } catch (e) {
      console.warn("[Chroniken-Sync]", e);
      return false;
    }
  }

  // ---------- Shared load / save ----------
  async function loadShared(name) {
    try {
      const list = await global.ChronikenStorage.load(name);
      const arr = Array.isArray(list) ? list : [];
      writeLocal(name, arr);
      return arr;
    } catch (e) {
      console.warn("[Chroniken-Sync] loadShared:", e);
      return readLocal(name);
    }
  }

  async function saveShared(name, list) {
    const value = Array.isArray(list) ? list : [];
    writeLocal(name, value);
    await global.ChronikenStorage.save(name, value);
    emit(true);
    return value;
  }

  // ---------- Charakter-Register ----------
  async function upsertRegistryEntry(entry) {
    if (!entry || !entry.id) return null;
    let saved = null;

    await mutate({
      characters: function (list) {
        const idx = list.findIndex(function (c) { return c.id === entry.id; });
        if (idx >= 0) {
          list[idx] = Object.assign({}, list[idx], entry);
          saved = list[idx];
        } else {
          saved = Object.assign({ createdAt: new Date().toISOString() }, entry);
          list.push(saved);
        }
        return list;
      }
    });

    return saved;
  }

  async function addCharacter(payload) {
    const id = payload.id || ("c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
    const entry = Object.assign({ id: id, createdAt: new Date().toISOString() }, payload);
    return upsertRegistryEntry(entry);
  }

  async function saveCharacter(entry) {
    return upsertRegistryEntry(entry);
  }

  async function removeCharacter(id) {
    await mutate({
      characters: function (list) {
        return list.filter(function (c) { return c.id !== id; });
      },
      characterSheets: function (list) {
        return list.filter(function (s) { return s.id !== id && s.characterId !== id; });
      }
    });
  }

  // ---------- Eingebettete Bögen migrieren (einmalig) ----------
  async function migrateEmbeddedSheets() {
    try {
      const chars = readLocal("characters");
      const sheets = readLocal("characterSheets");
      let changed = false;

      chars.forEach(function (c) {
        if (c.characterData && !sheets.some(function (s) { return s.id === c.id; })) {
          sheets.push({
            id: c.id,
            name: c.name,
            characterData: c.characterData,
            updatedAt: new Date().toISOString()
          });
          delete c.characterData;
          changed = true;
        }
      });

      if (changed) {
        await mutate({
          characters: function () { return chars; },
          characterSheets: function () { return sheets; }
        });
      }
    } catch (e) {
      console.warn("[Chroniken-Sync] migrateEmbeddedSheets:", e);
    }
  }

  // ---------- Öffentliche API (kompatibel zu vorher) ----------
  global.ChronikenSync = {
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
    upsertRegistryEntry: upsertRegistryEntry,
    addCharacter: addCharacter,
    saveCharacter: saveCharacter,
    removeCharacter: removeCharacter,
    async pushLocal() {
      const all = {};
      KEYS.forEach(function (k) { all[k] = readLocal(k); });
      await putRemote(all);
      emit(true);
    }
  };

  // Start
  function start() {
    pull()
      .then(function () {
        if (isAdmin()) return migrateEmbeddedSheets();
      })
      .catch(function (e) {
        console.warn("[Chroniken-Sync]", e);
        emit(false);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(typeof window !== "undefined" ? window : globalThis);
