-- Chroniken: JSONBin bridge / migration storage
-- Run this once in Supabase SQL Editor before using /admin/migrate-jsonbin.

create table if not exists public.chroniken_data (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.jsonbin_backups (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.chroniken_data enable row level security;
alter table public.jsonbin_backups enable row level security;

revoke all on table public.chroniken_data from anon, authenticated;
revoke all on table public.jsonbin_backups from anon, authenticated;

grant all on table public.chroniken_data to service_role;
grant all on table public.jsonbin_backups to service_role;
