-- Decline supersede: only retire OLDER siblings.
--
-- 0074 gave accept and decline the same supersede rule (all pending siblings
-- for the season + partner org). That's right for accept — an acceptance
-- resolves the pairing, and leaving any sibling acceptable would invite
-- double-scheduling. It's wrong for decline: if the partner declines an OLDER
-- duplicate while a NEWER corrected invite is pending, the newer operative
-- invite would be superseded — unacceptable forever, with a backwards
-- "replaced by a newer one" message. A decline only proves the invites SENT
-- BEFORE it are dead.
--
-- This redefines decline_interleague_invite with one change from 0074: the
-- supersede UPDATE adds `created_at < v_invite.created_at`. Accept's supersede
-- is intentionally untouched.

create or replace function public.decline_interleague_invite(
  p_token  text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interleague_invites%rowtype;
  v_sender_email text;
  v_sender_name text;
  v_sender_org_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_deleted int;
  v_reason text;
begin
  select * into v_invite
  from public.interleague_invites
  where token = p_token
  for update;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = 'P0001';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  with del as (
    delete from public.games
    where league_id = v_invite.season_id
      and interleague_org_id = v_invite.interleague_org_id
      and status = 'pending_interleague'
    returning 1
  )
  select count(*) into v_deleted from del;

  update public.interleague_invites
  set status         = 'declined',
      decline_reason = v_reason,
      updated_at     = now()
  where id = v_invite.id;

  -- Supersede only siblings SENT BEFORE the declined invite. A newer pending
  -- invite (e.g. a corrected re-send) stays acceptable — declining an old
  -- duplicate must never kill the operative one. (Accept supersedes ALL
  -- pending siblings; that asymmetry is deliberate.)
  update public.interleague_invites
  set status     = 'superseded',
      updated_at = now()
  where season_id          = v_invite.season_id
    and interleague_org_id = v_invite.interleague_org_id
    and id                <> v_invite.id
    and status             = 'pending'
    and created_at         < v_invite.created_at;

  select p.email, p.full_name, p.org_name
  into v_sender_email, v_sender_name, v_sender_org_name
  from public.profiles p where p.id = v_invite.sender_user_id;
  select o.name into v_org_name
  from public.interleague_orgs o where o.id = v_invite.interleague_org_id;
  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l where l.id = v_invite.season_id;

  return jsonb_build_object(
    'invite_id',       v_invite.id,
    'deleted_games',   v_deleted,
    'reason',          v_reason,
    'sender_email',    v_sender_email,
    'sender_name',     v_sender_name,
    'sender_org_name', v_sender_org_name,
    'org_name',        v_org_name,
    'season_name',     v_season_name,
    'season_label',    v_season_label,
    'recipient_email', v_invite.recipient_email
  );
end;
$$;

grant execute on function public.decline_interleague_invite(text, text) to anon, authenticated;
