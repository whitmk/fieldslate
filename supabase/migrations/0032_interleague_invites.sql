create table public.interleague_invites (
  id                   uuid        primary key default gen_random_uuid(),
  token                text        not null unique,
  sender_user_id       uuid        not null references auth.users(id) on delete cascade,
  interleague_org_id   uuid        not null references public.interleague_orgs(id) on delete cascade,
  season_id            uuid        not null references public.leagues(id) on delete cascade,
  recipient_email      text        not null,
  personal_note        text,
  status               text        not null default 'pending'
                       check (status in ('pending', 'accepted', 'declined')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index interleague_invites_token_idx
  on public.interleague_invites (token);

create index interleague_invites_sender_idx
  on public.interleague_invites (sender_user_id);

create index interleague_invites_org_idx
  on public.interleague_invites (interleague_org_id);

alter table public.interleague_invites enable row level security;

-- Senders can read invites they sent
create policy "Senders can select their own invites"
  on public.interleague_invites for select
  using (sender_user_id = auth.uid());

-- Senders can insert invites where they are the sender and own the org+season
create policy "Senders can insert their own invites"
  on public.interleague_invites for insert
  with check (
    sender_user_id = auth.uid()
    and interleague_org_id in (
      select id from public.interleague_orgs where owner_id = auth.uid()
    )
    and season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

-- Senders can update invites they sent (status changes etc.)
create policy "Senders can update their own invites"
  on public.interleague_invites for update
  using (sender_user_id = auth.uid())
  with check (sender_user_id = auth.uid());

-- Senders can delete invites they sent
create policy "Senders can delete their own invites"
  on public.interleague_invites for delete
  using (sender_user_id = auth.uid());

-- Reuse trigger function from migration 0028
create trigger interleague_invites_set_updated_at
  before update on public.interleague_invites
  for each row execute function public.set_updated_at();

grant all on public.interleague_invites to authenticated;
