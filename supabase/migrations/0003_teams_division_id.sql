alter table public.teams
  add column division_id uuid references public.divisions(id) on delete set null;
