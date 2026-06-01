-- Chunk 5: server enforcement of the per-season interleague partner cap.
--
-- Plan rules (authoritative; keep in sync with src/lib/plan/limits.ts):
--   free  → cannot initiate interleague at all      (limit 0)
--   pro   → at most 5 DISTINCT partner orgs / season (limit 5)
--   elite → unlimited                                (no cap)
--
-- Data-model note: interleague_orgs is an ORG-LEVEL address-book row
-- (owner_id, name, email…) with no season_id — it is reused across seasons.
-- The only thing that is actually "per season" is the INVITE
-- (interleague_invites.season_id), so the per-season partner cap is enforced
-- here, at invite creation. This RPC therefore creates the interleague_invite
-- row (the act that consumes a "partner org per season" slot) behind a cap
-- check — mirroring getInterleagueOrgCountForSeason() in src/lib/plan/counts.ts,
-- which counts DISTINCT interleague_org_id in interleague_invites for a season.
--
-- Org-scoping uses season_id -> leagues.owner_id (the canonical anchor);
-- sender_user_id is a misleading auth.users reference and is NOT used to scope.
--
-- Return contract (mirrors create_division / create_team / create_league):
--   Success:      { "row": <full inserted interleague_invites row as jsonb> }
--   Cap reached:  { "error": "cap_reached", "cap": "interleagueOrgsPerSeason",
--                   "limit": <int>, "plan": <plan> }
-- Other failures raise an exception with errcode P0001.

create or replace function public.create_interleague_org(
  p_season_id          uuid,
  p_interleague_org_id uuid,
  p_recipient_email    text,
  p_personal_note      text,
  p_token              text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_org_id   uuid;     -- org that owns the season (season_id -> leagues.owner_id)
  v_plan     text;
  v_count    int;      -- distinct partner orgs already invited to this season
  v_already  boolean;  -- is this org already a partner for this season?
  v_limit    int;
  v_row      public.interleague_invites%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select owner_id into v_org_id from public.leagues where id = p_season_id;
  if v_org_id is null then
    raise exception 'season_not_found' using errcode = 'P0001';
  end if;

  if not public.is_org_member(v_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  -- The partner org must belong to the same org (owner-scoped, like the UI).
  if not exists (
    select 1 from public.interleague_orgs
     where id = p_interleague_org_id and owner_id = v_org_id
  ) then
    raise exception 'interleague_org_not_found' using errcode = 'P0001';
  end if;

  v_plan := coalesce(
    (select plan from public.profiles where id = v_org_id),
    'free'
  );

  -- A re-invite to an org that is ALREADY a season partner does not consume a
  -- new slot, so it never trips the cap.
  select exists (
    select 1 from public.interleague_invites
     where season_id = p_season_id
       and interleague_org_id = p_interleague_org_id
  ) into v_already;

  select count(distinct interleague_org_id) into v_count
    from public.interleague_invites
   where season_id = p_season_id;

  if v_plan = 'free' then
    return jsonb_build_object(
      'error', 'cap_reached',
      'cap',   'interleagueOrgsPerSeason',
      'limit', 0,
      'plan',  v_plan
    );
  end if;

  if v_plan = 'pro' and not v_already and v_count >= 5 then
    return jsonb_build_object(
      'error', 'cap_reached',
      'cap',   'interleagueOrgsPerSeason',
      'limit', 5,
      'plan',  v_plan
    );
  end if;
  -- elite: unlimited — fall through to insert.

  insert into public.interleague_invites (
    token,
    sender_user_id,
    interleague_org_id,
    season_id,
    recipient_email,
    personal_note
  ) values (
    p_token,
    v_org_id,             -- the org, so any org admin can manage the invite
    p_interleague_org_id,
    p_season_id,
    p_recipient_email,
    p_personal_note
  )
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_interleague_org(uuid, uuid, text, text, text) from public;
grant execute on function public.create_interleague_org(uuid, uuid, text, text, text) to authenticated;
