alter table public.leagues
  add column if not exists schedule_settings jsonb;
