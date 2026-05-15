create table public.interleague_orgs (
  id           uuid        primary key default gen_random_uuid(),
  owner_id     uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  admin_email  text        not null,
  contact_name text,
  contact_phone text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.interleague_orgs enable row level security;

create policy "Users can select their own interleague orgs"
  on public.interleague_orgs for select
  using (owner_id = auth.uid());

create policy "Users can insert their own interleague orgs"
  on public.interleague_orgs for insert
  with check (owner_id = auth.uid());

create policy "Users can update their own interleague orgs"
  on public.interleague_orgs for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Users can delete their own interleague orgs"
  on public.interleague_orgs for delete
  using (owner_id = auth.uid());

-- Auto-update updated_at on row modification
create or replace function public.set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger interleague_orgs_set_updated_at
  before update on public.interleague_orgs
  for each row execute function public.set_updated_at();

grant all on public.interleague_orgs to authenticated;
