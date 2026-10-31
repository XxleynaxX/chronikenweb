# 🛡️ Die Chroniken · Rollenspiel-Portal

> **Das Zeitalter der Asche**  
> Eine webbasierte Plattform für das **Chroniken-Rollenspiel** mit Charakterverwaltung, Lore, Wiki, Kalender, Events, Wetter, Mondphasen und Discord-Anbindung.

**Live:** https://xxleynaxx.github.io/chronikenweb/  
**Repository:** https://github.com/XxleynaxX/chronikenweb

---

## 🌙 Über das Projekt

Was ursprünglich als einfacher digitaler **Charakterbogen** begann, ist inzwischen zu einem vollständigen Rollenspiel-Portal gewachsen.

Die Website verbindet die wichtigsten Bereiche von **Die Chroniken** an einem Ort:

- Charaktere und Charakterbögen
- Völker und Berufe
- Götter und Kulte
- Kreaturen
- Wiki und Bibliothek
- Ingame-Kalender und Events
- News
- Fantasy-Wetter und Mondphasen
- Heilerakten
- Discord-Anmeldung und Rollenverwaltung
- Discord-Benachrichtigungen
- zentrale Datensynchronisation

Das Ziel ist nicht nur eine hübsche Website, sondern ein kleines **digitales Ökosystem für das RP**.

---

## ✨ Bereiche der Website

| Bereich | Funktion |
|---|---|
| 👤 **Charakterbogen** | Charakterdaten, Aussehen, Völker, Berufe, Magie, Gesinnung und OOC-Angaben |
| 🛡️ **Charakterverwaltung** | Verwaltung von Charakteren, IDs, Verwarnungen, Regelverstößen und Notizen |
| 📖 **Wiki** | Zentrale Wissenssammlung für die Welt |
| 📚 **Bibliothek** | Erweiterbare Ingame-Inhalte und Dokumente |
| 🧬 **Völker** | Übersicht über Völker und Unterrassen |
| ⚒️ **Berufe** | Haupt- und Nebenberufe |
| ⚜️ **Götter** | Götter, Kulte und zugehörige Informationen |
| 🐾 **Kreaturen** | Friedliche und wilde Wesen, inklusive magischer Kreaturen |
| 📅 **Kalender** | Ingame-Zeitrechnung, Termine und Geburtstage |
| 🎉 **Events** | Events, Geburtstage und weitere RP-Termine |
| 📰 **News** | Neuigkeiten des Projekts und Servers |
| 🌦️ **Wetter** | Fantasy-Wetter mit serverseitiger Synchronisation |
| 🌙 **Mondphasen** | Mondzyklus und besondere nächtliche Ereignisse |
| 🩺 **Heilerakte** | RP-Verwaltung von Heilerakten mit Discord-Benachrichtigungen |
| 🔧 **Mod-Watcher** | Meldungen über erkannte Conan-Exiles-Mod-Updates |

---

## 🔐 Discord-Anmeldung

Die Website besitzt eine **Discord-OAuth2-Anmeldung**.

Die Berechtigungen werden nicht einfach anhand eines frei eingegebenen Passworts vergeben, sondern über Discord-Rollen geprüft.

### Rollenbasierte Bereiche

- 🛡️ **Admin** → Verwaltung, Wetter und weitere Admin-Funktionen
- 📚 **Bibliothek** → Schreibzugriff auf die Bibliothek
- 🩺 **Heiler** → Zugriff auf die Heilerakte
- 👤 **Mitglieder** → normale Website-Nutzung

Die Anmeldung läuft über den separaten **Chroniken Discord Proxy**, der auf einem Render-Service betrieben wird.

> **Wichtig:** Zugangsdaten, Tokens, Webhooks und andere Geheimnisse gehören ausschließlich in Umgebungsvariablen und werden nicht im Repository gespeichert.

---

## 🔗 Architektur

Die Website besteht aus mehreren miteinander verbundenen Teilen:

```text
                    ┌─────────────────────┐
                    │     Discord         │
                    │ Rollen / OAuth2     │
                    └──────────┬──────────┘
                               │
                               ▼
┌──────────────────┐    ┌─────────────────────┐
│ GitHub Pages     │◄──►│ Discord Proxy       │
│ Chroniken Web    │    │ Render / Node.js    │
└────────┬─────────┘    └──────────┬──────────┘
         │                         │
         │                         ├── Discord Webhooks
         │                         ├── Rollenprüfung
         │                         ├── Wetter
         │                         ├── Mondphasen
         │                         ├── Heilerakte
         │                         └── Mod-Watcher
         │
         ▼
┌─────────────────────┐
│ Supabase             │
│ zentrale RP-Daten   │
└─────────────────────┘
```

### Kurz erklärt

**GitHub Pages** stellt die eigentliche Website bereit.

Der **Render-Service** übernimmt Aufgaben, die nicht direkt im Browser stattfinden sollen, darunter Discord-OAuth2, Rollenprüfung, Wetter-Synchronisation und Discord-Webhooks.

**Supabase** dient als zentrale Speicherung für gemeinsame RP-Daten. Der Browser verwendet zusätzlich `localStorage` als lokalen Cache.

---

## 🌦️ Fantasy-Wetter

Das Wetter ist nicht an das reale Wetter gebunden.

Stattdessen besitzt Chroniken ein eigenes Fantasy-Wettersystem mit frei definierbaren Wetterlagen.

Beispiele:

- ☀️ Klarer Himmel
- 🌬️ Leichter Wind
- 🌫️ Nebel
- ⛈️ Gewitter
- ❄️ Schneefall
- 🌧️ Regen
- und weitere eigene Wetterlagen

Das aktuelle Wetter wird serverseitig synchronisiert, sodass Website und Discord nicht voneinander abweichen.

Der Admin kann das Wetter außerdem manuell setzen.

---

## 🌙 Mondphasen

Neben dem Wetter besitzt Chroniken einen eigenen Mondzyklus.

Besondere Phasen und Ereignisse können für das Rollenspiel verwendet werden, beispielsweise:

- 🌕 Vollmond
- 🌓 Halbmond
- 🌑 Neumond
- 🌘 abnehmender Mond
- 🌒 zunehmender Mond
- 🌑 besondere Nächte und RP-Ereignisse

Dadurch können Wetter, Zeitrechnung und Lore miteinander verbunden werden.

---

## 📅 Ingame-Zeitrechnung

| Reale Zeit | Ingame-Zeit |
|---|---|
| 1 realer Tag | 2 Ingame-Tage |
| 15 reale Tage | 1 Ingame-Monat |
| 30 Ingame-Tage | 1 Ingame-Monat |
| 12 Ingame-Monate | 1 Ingame-Jahr |
| Start | **17.10.2026 · 1. Frostmond 1400** |

Die Zeitrechnung bildet die Grundlage für Kalender, Geburtstage und zeitabhängige RP-Ereignisse.

---

## 💾 Datenspeicherung

Je nach Bereich werden unterschiedliche Speicherwege verwendet:

### Browser

`localStorage` dient als lokaler Cache und für browserbezogene Daten.

### Supabase

Gemeinsame Daten wie Events, News, Geburtstage, Kalenderdaten und Charakterdaten können zentral synchronisiert werden.

### Render

Der Backend-Service übernimmt serverseitige Funktionen und schützt sensible Konfigurationen wie:

- Discord Client Secret
- Auth Secret
- Webhook-URLs
- Rollen-Konfiguration
- weitere Umgebungsvariablen

---

## 🖼️ Charakterbogen

Der Charakterbogen war der Ausgangspunkt des gesamten Projekts.

Unter anderem unterstützt er:

- 👤 allgemeine Charakterdaten
- 🧬 Volk und Unterrasse
- 📏 Größenprüfung
- ✨ Magie
- ⚒️ Berufe
- 👁️ Aussehen und Merkmale
- ⚖️ Gesinnung
- 🔒 OOC-Grenzen
- 🎂 Ingame-Geburtstag
- 💾 JSON Import und Export
- 🖼️ PNG-Export

Der Charakterbogen kann damit sowohl als Formular als auch als fertige Charakterdokumentation verwendet werden.

---

## 📁 Projektstruktur

```text
chronikenweb/
│
├── index.html
├── charakterbogen.html
├── admin.html
├── kalender.html
├── events.html
├── news.html
│
├── wiki.html
├── bibliothek.html
├── regeln.html
│
├── voelker.html
├── berufe.html
├── goetter.html
├── kreaturen.html
├── heilerakte.html
│
├── wetter.html
├── wetter.js
├── weather-config.js
│
├── chroniken-auth.js
├── chroniken-data.js
├── chroniken-sync.js
├── chroniken-storage.js
│
├── style.css
├── chroniken-admin.css
├── legal-notice.js
│
└── chroniken-discord-proxy/
    ├── server.js
    ├── weather.js
    ├── mond.js
    └── mod-watcher/
```

---

## 🧩 Verwendete Technologien

- **HTML5**
- **CSS3**
- **JavaScript**
- **Node.js**
- **Discord OAuth2**
- **Discord Webhooks**
- **Supabase**
- **GitHub Pages**
- **Render**
- **html2canvas**
- **localStorage / sessionStorage**

Das Projekt kommt ohne großes Framework aus. Der Schwerpunkt liegt auf einer überschaubaren, direkten Architektur mit möglichst wenig unnötigen Abhängigkeiten.

---

## 🚀 Lokal starten

Für die reine Website können die HTML-Dateien direkt geöffnet oder über einen kleinen lokalen Webserver bereitgestellt werden.

Für Funktionen wie Discord-Anmeldung, zentrale Synchronisation, Wetter und Webhooks wird zusätzlich der **Discord-Proxy** benötigt.

### Website

```text
index.html
```

### Backend

Der Proxy wird als Node.js-Service betrieben.

```bash
node server.js
```

Die benötigten Geheimnisse und Konfigurationen werden über **Environment Variables** gesetzt.

---

## 🛠️ Projektstatus

**Die Chroniken** befindet sich in aktiver Entwicklung.

Neue Funktionen werden direkt in die bestehende RP-Struktur integriert. Dadurch wächst das Projekt Schritt für Schritt von einem einfachen Charakterbogen zu einer umfassenden Verwaltungs- und Wissensplattform für das Rollenspiel.

---

## 👑 Projekt

**Die Chroniken – Das Zeitalter der Asche**

Entwickelt und gepflegt von **Kiyasha**.

> *Eine Welt besteht nicht nur aus ihrer Geschichte.  
> Sie besteht aus den Spuren, die ihre Bewohner hinterlassen.*

---

## 📄 Lizenz / Copyright

© Kiyasha · Die Chroniken

Dieses Repository ist ein privates Rollenspielprojekt. Inhalte, Lore, Texte, Grafiken und projektspezifische Daten sind nicht automatisch zur freien Weiterverwendung freigegeben.
