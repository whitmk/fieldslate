-- Umpire pay tracking: per-umpire rates, per-role rates, and season-level settings.

-- 1. Pay rate on individual umpires (used in per_umpire mode)
alter table public.umpires
  add column pay_rate numeric null;

-- 2. Pay tracking toggle and mode on seasons/leagues
alter table public.leagues
  add column pay_tracking_enabled boolean not null default false,
  add column pay_rate_mode text not null default 'per_umpire'
    check (pay_rate_mode in ('per_umpire', 'per_role'));

-- 3. Per-role rates (used in per_role mode): one row per season/role pair
create table public.umpire_role_rates (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.leagues(id) on delete cascade,
  role text not null,
  rate numeric not null default 0,
  created_at timestamptz not null default now(),
  unique(season_id, role)
);

create index umpire_role_rates_season_id_idx on public.umpire_role_rates (season_id);

alter table public.umpire_role_rates enable row level security;

create policy "Season owners can read role rates"
  on public.umpire_role_rates for select
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can insert role rates"
  on public.umpire_role_rates for insert
  with check (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can update role rates"
  on public.umpire_role_rates for update
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can delete role rates"
  on public.umpire_role_rates for delete
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

grant all on public.umpire_role_rates to authenticated;

-- 4. Payment status on individual game assignments for unpaid-games tracking
alter table public.game_umpires
  add column paid boolean not null default false;
