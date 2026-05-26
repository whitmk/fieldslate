-- profiles.org_name — the umbrella organization label shown in the Overview
-- greeting, Divisions section headings, and anywhere else the org identity
-- (not a specific season) is displayed. Nullable so existing rows stay valid
-- pre-backfill; new signups fill it via the wizard / settings.
alter table public.profiles
  add column if not exists org_name text;

-- Backfill: anyone who already has at least one league inherits its name as
-- their org name. We pick the earliest league by created_at so the value is
-- stable on re-run. Profiles with no leagues remain null and will fall back
-- to the UI default.
update public.profiles p
  set org_name = sub.name
  from (
    select distinct on (owner_id) owner_id, name
      from public.leagues
      order by owner_id, created_at asc
  ) sub
  where p.id = sub.owner_id
    and p.org_name is null;
