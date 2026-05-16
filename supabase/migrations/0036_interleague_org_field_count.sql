-- How many fields the external org has — caps how many away games we can
-- schedule against them on the same day (one game per field per day, default 1).

alter table public.interleague_orgs
  add column field_count integer not null default 1
    check (field_count >= 1);
