-- ============================================================
-- Chroniken – sauberes Supabase-Schema
-- Für den Table Editor: klar, dokumentiert, wartbar
-- ============================================================
-- Ausführen im Supabase SQL Editor (einmalig).
-- Danach: Table Editor → chroniken_data sieht professionell aus.
-- ============================================================

-- 1) Haupttabelle (Key-Value mit JSONB – flexibel für alle RP-Daten)
create table if not exists public.chroniken_data (
  key         text primary key,
  value       jsonb not null default '[]'::jsonb,
  label       text,                          -- lesbarer Name im Table Editor
  description text,                          -- kurze Erklärung
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Kommentare (sichtbar im Table Editor / Schema)
comment on table  public.chroniken_data is 'Zentrale RP-Daten der Chroniken. Jeder Key hält eine JSON-Liste oder ein Objekt.';
comment on column public.chroniken_data.key         is 'Technischer Schlüssel (z. B. races, events, character_sheets)';
comment on column public.chroniken_data.value       is 'Die eigentlichen Daten als JSONB (Array oder Objekt)';
comment on column public.chroniken_data.label       is 'Anzeigename für den Table Editor';
comment on column public.chroniken_data.description is 'Kurze Beschreibung des Inhalts';
comment on column public.chroniken_data.updated_at  is 'Letzte Änderung';
comment on column public.chroniken_data.created_at  is 'Erstellt am';

-- Index für schnelle Abfragen nach Änderungszeit
create index if not exists chroniken_data_updated_at_idx
  on public.chroniken_data (updated_at desc);

-- Automatisch updated_at setzen
create or replace function public.set_chroniken_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_chroniken_updated_at on public.chroniken_data;
create trigger trg_chroniken_updated_at
  before update on public.chroniken_data
  for each row
  execute function public.set_chroniken_updated_at();

-- 2) Bekannte Keys mit Labels vorausfüllen (sieht im Editor sofort sauber aus)
--    value bleibt leer – wird von der Website befüllt.
insert into public.chroniken_data (key, value, label, description) values
  ('races',             '[]'::jsonb, 'Völker',              'Spielbare Rassen / Völker mit Subrassen und Attributen'),
  ('professions',       '[]'::jsonb, 'Berufe',              'Berufe und Handwerke der Welt'),
  ('gods',              '[]'::jsonb, 'Götter',              'Pantheon und göttliche Wesen'),
  ('creatures',         '[]'::jsonb, 'Kreaturen',           'Monster, Tiere und mythische Wesen'),
  ('wiki',              '[]'::jsonb, 'Wiki',                'Wiki-Einträge und Lore-Texte'),
  ('library',           '[]'::jsonb, 'Bibliothek',          'Bücher und Schriften'),
  ('rules',             '[]'::jsonb, 'Regeln',              'Server- und RP-Regeln'),
  ('news',              '[]'::jsonb, 'News',                'Ankündigungen und Neuigkeiten'),
  ('events',            '[]'::jsonb, 'Events',              'RP-Events und Termine'),
  ('character_events',  '[]'::jsonb, 'Charakter-Events',    'Persönliche Events der Charaktere'),
  ('birthdays',         '[]'::jsonb, 'Geburtstage',         'Geburtstage der Charaktere'),
  ('calendar',          '[]'::jsonb, 'Kalender',            'Eigene Kalendereinträge'),
  ('disabled_holidays', '[]'::jsonb, 'Deaktivierte Feiertage', 'Feiertage die ausgeblendet werden'),
  ('weather',           '{}'::jsonb, 'Wetter',              'Aktuelles Fantasy-Wetter (Objekt)'),
  ('characters',        '[]'::jsonb, 'Charakter-Register',  'Öffentliches Charakter-Register'),
  ('character_sheets',  '[]'::jsonb, 'Charakterbögen',      'Ausgefüllte Charakterbögen'),
  ('healer_records',    '[]'::jsonb, 'Heilerakten',         'Medizinische RP-Aufzeichnungen'),
  ('map',               '[]'::jsonb, 'Karte',               'Kartenmarker und Orte')
on conflict (key) do update set
  label       = excluded.label,
  description = excluded.description;
  -- value wird bewusst NICHT überschrieben

-- 3) Row Level Security
alter table public.chroniken_data enable row level security;

-- Aktuell: öffentliches Lesen + Schreiben (wie bisher mit Publishable Key).
-- Später einschränken: nur authenticated oder nur über den Render-Proxy (Service Role).

drop policy if exists "chroniken_data_public_read" on public.chroniken_data;
create policy "chroniken_data_public_read"
  on public.chroniken_data
  for select
  to anon, authenticated
  using (true);

drop policy if exists "chroniken_data_public_write" on public.chroniken_data;
create policy "chroniken_data_public_write"
  on public.chroniken_data
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 4) Realtime (optional – für Live-Updates im Browser)
-- Im Dashboard: Database → Replication → chroniken_data aktivieren
-- oder:
-- alter publication supabase_realtime add table public.chroniken_data;

-- 5) Praktische View für den Table Editor (Key + Label + Vorschau)
create or replace view public.chroniken_overview as
select
  key,
  label,
  description,
  case
    when jsonb_typeof(value) = 'array' then jsonb_array_length(value)::text || ' Einträge'
    when jsonb_typeof(value) = 'object' then 'Objekt'
    else '–'
  end as preview,
  updated_at,
  created_at
from public.chroniken_data
order by label nulls last, key;

comment on view public.chroniken_overview is 'Übersicht aller Chroniken-Datenkeys mit Vorschau – ideal für den Table Editor';

-- Fertig.
-- Table Editor → chroniken_data   → alle Keys mit Label & Description
-- Table Editor → chroniken_overview → kompakte Übersicht

-- ============================================================
-- Optional: Alte Key-Namen auf die neuen snake_case Keys mappen
-- (nur ausführen, wenn schon Daten unter den alten Namen liegen)
-- ============================================================
/*
update public.chroniken_data set key = 'character_events'  where key = 'characterEvents';
update public.chroniken_data set key = 'disabled_holidays' where key = 'disabledHolidays';
update public.chroniken_data set key = 'character_sheets'  where key = 'characterSheets';
-- falls doppelte Keys entstehen: den älteren löschen oder manuell mergen
*/
