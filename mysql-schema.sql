-- ============================================================
-- Chroniken – MySQL-Schema (MySQL 5.7+ / 8.x, MariaDB 10.5+)
-- ============================================================
-- Der Proxy legt Tabelle + Schlüssel beim Start automatisch an.
-- Diese Datei ist für manuelles Einrichten (phpMyAdmin, mysql-CLI)
-- und als Dokumentation. Mehrfaches Ausführen ist unschädlich.
--
--   mysql -u USER -p DATENBANK < mysql-schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS chroniken_data (
  `key`       VARCHAR(64)  NOT NULL COMMENT 'Technischer Schlüssel (z. B. races, events)',
  `value`     JSON         NOT NULL COMMENT 'Daten als JSON (Array oder Objekt)',
  label       VARCHAR(100) NULL     COMMENT 'Anzeigename',
  description VARCHAR(255) NULL     COMMENT 'Kurze Beschreibung',
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  KEY chroniken_data_updated_at_idx (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Zentrale RP-Daten der Chroniken (Key-Value mit JSON)';

-- Bekannte Schlüssel vorbelegen. Vorhandene Werte werden NICHT überschrieben.
INSERT INTO chroniken_data (`key`, `value`, label, description) VALUES
  ('races',             JSON_ARRAY(),  'Völker',                 'Spielbare Rassen / Völker mit Subrassen und Attributen'),
  ('professions',       JSON_ARRAY(),  'Berufe',                 'Berufe und Handwerke der Welt'),
  ('gods',              JSON_ARRAY(),  'Götter',                 'Pantheon und göttliche Wesen'),
  ('creatures',         JSON_ARRAY(),  'Kreaturen',              'Monster, Tiere und mythische Wesen'),
  ('wiki',              JSON_ARRAY(),  'Wiki',                   'Wiki-Einträge und Lore-Texte'),
  ('library',           JSON_ARRAY(),  'Bibliothek',             'Bücher und Schriften'),
  ('rules',             JSON_ARRAY(),  'Regeln',                 'Server- und RP-Regeln'),
  ('news',              JSON_ARRAY(),  'News',                   'Ankündigungen und Neuigkeiten'),
  ('events',            JSON_ARRAY(),  'Events',                 'RP-Events und Termine'),
  ('character_events',  JSON_ARRAY(),  'Charakter-Events',       'Persönliche Events der Charaktere'),
  ('birthdays',         JSON_ARRAY(),  'Geburtstage',            'Geburtstage der Charaktere'),
  ('calendar',          JSON_ARRAY(),  'Kalender',               'Eigene Kalendereinträge'),
  ('disabled_holidays', JSON_ARRAY(),  'Deaktivierte Feiertage', 'Feiertage die ausgeblendet werden'),
  ('weather',           JSON_OBJECT(), 'Wetter',                 'Aktuelles Fantasy-Wetter (Objekt)'),
  ('moon',              JSON_OBJECT(), 'Mond',                   'Mondphasen und Zyklus-Zustand (Objekt)'),
  ('characters',        JSON_ARRAY(),  'Charakter-Register',     'Öffentliches Charakter-Register'),
  ('character_sheets',  JSON_ARRAY(),  'Charakterbögen',         'Ausgefüllte Charakterbögen'),
  ('healer_records',    JSON_ARRAY(),  'Heilerakten',            'Medizinische RP-Aufzeichnungen'),
  ('map',               JSON_ARRAY(),  'Karte',                  'Kartenmarker und Orte')
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

-- Übersicht: Schlüssel + Anzahl Einträge
CREATE OR REPLACE VIEW chroniken_overview AS
SELECT `key`, label, description,
       CASE JSON_TYPE(`value`)
         WHEN 'ARRAY'  THEN CONCAT(JSON_LENGTH(`value`), ' Einträge')
         WHEN 'OBJECT' THEN 'Objekt'
         ELSE '–'
       END AS preview,
       updated_at, created_at
FROM chroniken_data
ORDER BY label, `key`;


CREATE TABLE IF NOT EXISTS admin_blacklist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  steam_id VARCHAR(32) NOT NULL UNIQUE,
  discord_id VARCHAR(32) NULL,
  discord_tag VARCHAR(255) NULL,
  player_name VARCHAR(255) NULL,
  reason TEXT NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_admin_blacklist_steam(steam_id),
  INDEX idx_admin_blacklist_discord(discord_id),
  INDEX idx_admin_blacklist_tag(discord_tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Tagebuch
CREATE TABLE IF NOT EXISTS diary_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  char_id VARCHAR(32) NOT NULL,
  discord_id VARCHAR(32) NOT NULL,
  discord_name VARCHAR(255) NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  entry_date DATE NOT NULL,
  admin_seen TINYINT(1) NOT NULL DEFAULT 0,
  user_seen_comments TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_diary_char(char_id),
  INDEX idx_diary_discord(discord_id),
  INDEX idx_diary_date(entry_date),
  INDEX idx_diary_admin_seen(admin_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS diary_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_id INT NOT NULL,
  discord_id VARCHAR(32) NOT NULL,
  author_name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_diary_comments_entry(entry_id),
  CONSTRAINT fk_diary_comment_entry FOREIGN KEY (entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
