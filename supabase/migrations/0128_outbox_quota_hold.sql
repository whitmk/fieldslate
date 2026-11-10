-- 0128 — Outbox quota hold + email problems for admins (2026-11-10, branch
-- fix/outbox-quota). Plan: docs/plans/game-change-followthrough.md, "Step 0.5".
--
-- THE BUG: a Resend quota stop (100 a day on the Free plan) was retried like
-- any failure — 5 attempts over about 30 minutes, then `failed` for good — so
-- the rest of the day's emails in BOTH outboxes were lost, and no admin
-- screen showed an outbox failure at all.
--
-- WHAT IT ADDS
--   1. `acknowledged_at` on volunteer_outbox, official_outbox and
--      volunteer_trigger_failures ("Mark as seen" on the admin banners).
--   2. volunteer_outbox_hold / official_outbox_hold (service_role): put a row
--      the drain took back to `pending` until a given time WITHOUT using an
--      attempt (the take counted one; the hold gives it back). Reasons:
--      quota_daily, quota_monthly, rate_limited. Acts only on a row still
--      `sending`.
--   3. volunteer_outbox_drop_started (service_role): a pending email about a
--      game or shift whose spot has already started (league time) is
--      superseded with error `game_started` — a notice that waited (quota,
--      retry, the 10-minute hold) never arrives after the game. Kinds:
--      game_moved, rained_out, makeup_set, back_on, shift_changed, spot_lost.
--      The drain calls it before every take.
--   4. volunteer_email_problems / official_email_problems (authenticated,
--      the feature's admin gate: member → switch → Elite → not archived):
--      the season's unacknowledged failed emails (who, what, why), how many
--      are waiting for a quota reset, and (volunteers) unacknowledged
--      trigger failures. Names leave ONLY through these two functions, to
--      members. Never callable by anon.
--   5. volunteer_email_problems_ack / official_email_problems_ack
--      (authenticated, same gate): mark failed rows (and, for volunteers,
--      trigger failures) as seen.
--
-- Nothing here re-creates an existing function: the takes and finishes are
-- unchanged (no mutant re-targeting).
--
-- LOCKS when applied: ACCESS EXCLUSIVE on volunteer_outbox, official_outbox
-- and volunteer_trigger_failures for the ADD COLUMN (nullable, no default —
-- no rewrite; no browser screen reads these tables). The drains may wait a
-- moment. Nothing on games, leagues, profiles.
--
-- Deploy order: apply 0128 BEFORE the code reaches main — the drains call the
-- hold and drop functions, the banners call the problems functions.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ────────────────────────────────────────────────────────────────────────────
alter table public.volunteer_outbox           add column acknowledged_at timestamptz;
alter table public.official_outbox            add column acknowledged_at timestamptz;
alter table public.volunteer_trigger_failures add column acknowledged_at timestamptz;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Hold a taken row without using an attempt
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_outbox_hold(p_id bigint, p_until timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_reason is null or p_reason not in ('quota_daily', 'quota_monthly', 'rate_limited') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;
  -- Only a row this drain still holds; the take's attempt is given back.
  update public.volunteer_outbox
     set status = 'pending', locked_at = null,
         next_attempt_at = greatest(coalesce(p_until, now()), now()),
         attempts = greatest(attempts - 1, 0),
         error = p_reason
   where id = p_id and status = 'sending';
  return jsonb_build_object('updated', found);
end;
$$;

create or replace function public.official_outbox_hold(p_id bigint, p_until timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_reason is null or p_reason not in ('quota_daily', 'quota_monthly', 'rate_limited') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;
  update public.official_outbox
     set status = 'pending', locked_at = null,
         next_attempt_at = greatest(coalesce(p_until, now()), now()),
         attempts = greatest(attempts - 1, 0),
         error = p_reason
   where id = p_id and status = 'sending';
  return jsonb_build_object('updated', found);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Drop volunteer notices about a spot that has already started
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_outbox_drop_started()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  -- The spot's start comes from volunteer_email_spots (the take's own
  -- description: a game's start less the role's lead, a shift's start, or a
  -- detached spot's remembered start), compared with now in league time.
  with started as (
    select o.id
      from public.volunteer_outbox o
     where o.status = 'pending'
       and o.kind in ('game_moved', 'rained_out', 'makeup_set', 'back_on', 'shift_changed', 'spot_lost')
       and o.payload ? 'claim_id'
       and ((public.volunteer_email_spots(array[(o.payload ->> 'claim_id')::uuid]) -> 0 ->> 'start')::timestamp
              <= public.volunteer_org_now(o.owner_id))
  )
  update public.volunteer_outbox o
     set status = 'superseded', error = 'game_started'
    from started
   where o.id = started.id and o.status = 'pending';
  get diagnostics v_n = row_count;
  return jsonb_build_object('dropped', v_n);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. What the admin banners show
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_email_problems(p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  v_owner := public.volunteer_admin_gate(p_season_id, false);
  return jsonb_build_object(
    'timezone', (select p.timezone from public.profiles p where p.id = v_owner),
    'failed', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id,
               'kind', o.kind,
               'error', o.error,
               'at', o.created_at,
               'first_initial', v.first_initial,
               'last_name', v.last_name,
               'spot', case
                         when o.payload ? 'claim_id'
                           then public.volunteer_email_spots(array[(o.payload ->> 'claim_id')::uuid]) -> 0
                         when jsonb_typeof(o.payload -> 'claim_ids') = 'array'
                           then public.volunteer_email_spots(array(select x::uuid from jsonb_array_elements_text(o.payload -> 'claim_ids') x)) -> 0
                       end
             ) order by o.created_at desc, o.id desc), '[]'::jsonb)
        from public.volunteer_outbox o
        left join public.volunteers v on v.id = o.volunteer_id
       where o.season_id = p_season_id and o.status = 'failed' and o.acknowledged_at is null),
    'waiting', (
      select jsonb_build_object(
               'count', count(*),
               'reason', case when bool_or(o.error = 'quota_monthly') then 'quota_monthly' else 'quota_daily' end,
               'until', max(o.next_attempt_at))
        from public.volunteer_outbox o
       where o.season_id = p_season_id and o.status = 'pending'
         and o.error in ('quota_daily', 'quota_monthly')),
    'trigger_failures', (
      select count(*) from public.volunteer_trigger_failures f
       where f.season_id = p_season_id and f.acknowledged_at is null)
  );
end;
$$;

create or replace function public.official_email_problems(p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  v_owner := public.official_signup_gate(p_season_id, false);
  return jsonb_build_object(
    'timezone', (select p.timezone from public.profiles p where p.id = v_owner),
    'failed', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id,
               'kind', o.kind,
               'error', o.error,
               'at', o.created_at,
               'official_name', u.name,
               'to_contact', o.kind in ('drop_notice', 'claims_digest'),
               'game', case when o.payload ? 'game_id'
                            then public.official_game_json((o.payload ->> 'game_id')::uuid, o.payload ->> 'role') end
             ) order by o.created_at desc, o.id desc), '[]'::jsonb)
        from public.official_outbox o
        left join public.umpires u on u.id = o.umpire_id
       where o.season_id = p_season_id and o.status = 'failed' and o.acknowledged_at is null),
    'waiting', (
      select jsonb_build_object(
               'count', count(*),
               'reason', case when bool_or(o.error = 'quota_monthly') then 'quota_monthly' else 'quota_daily' end,
               'until', max(o.next_attempt_at))
        from public.official_outbox o
       where o.season_id = p_season_id and o.status = 'pending'
         and o.error in ('quota_daily', 'quota_monthly'))
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Mark as seen
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_email_problems_ack(p_season_id uuid, p_ids bigint[], p_trigger_failures boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
  v_f integer := 0;
begin
  perform public.volunteer_admin_gate(p_season_id, true);
  update public.volunteer_outbox
     set acknowledged_at = now()
   where season_id = p_season_id and status = 'failed' and acknowledged_at is null
     and id = any (coalesce(p_ids, '{}'::bigint[]));
  get diagnostics v_n = row_count;
  if coalesce(p_trigger_failures, false) then
    update public.volunteer_trigger_failures
       set acknowledged_at = now()
     where season_id = p_season_id and acknowledged_at is null;
    get diagnostics v_f = row_count;
  end if;
  return jsonb_build_object('acknowledged', v_n, 'trigger_failures', v_f);
end;
$$;

create or replace function public.official_email_problems_ack(p_season_id uuid, p_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  perform public.official_signup_gate(p_season_id, true);
  update public.official_outbox
     set acknowledged_at = now()
   where season_id = p_season_id and status = 'failed' and acknowledged_at is null
     and id = any (coalesce(p_ids, '{}'::bigint[]));
  get diagnostics v_n = row_count;
  return jsonb_build_object('acknowledged', v_n);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Privileges (revoke from PUBLIC, then grant back — the house rule)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.volunteer_outbox_hold(bigint, timestamptz, text)              from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_outbox_hold(bigint, timestamptz, text)               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_outbox_drop_started()                               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_email_problems(uuid)                                from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_email_problems(uuid)                                 from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_email_problems_ack(uuid, bigint[], boolean)        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_email_problems_ack(uuid, bigint[])                  from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.volunteer_outbox_hold(bigint, timestamptz, text)        to service_role;
grant execute on function public.official_outbox_hold(bigint, timestamptz, text)         to service_role;
grant execute on function public.volunteer_outbox_drop_started()                         to service_role;
grant execute on function public.volunteer_email_problems(uuid)                          to authenticated;
grant execute on function public.official_email_problems(uuid)                           to authenticated;
grant execute on function public.volunteer_email_problems_ack(uuid, bigint[], boolean)  to authenticated;
grant execute on function public.official_email_problems_ack(uuid, bigint[])            to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Verify, or the whole migration rolls back
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f    text;
  r    text;
  v_sr text[] := array['public.volunteer_outbox_hold(bigint, timestamptz, text)',
                       'public.official_outbox_hold(bigint, timestamptz, text)',
                       'public.volunteer_outbox_drop_started()'];
  v_au text[] := array['public.volunteer_email_problems(uuid)',
                       'public.official_email_problems(uuid)',
                       'public.volunteer_email_problems_ack(uuid, bigint[], boolean)',
                       'public.official_email_problems_ack(uuid, bigint[])'];
begin
  foreach f in array v_sr || v_au loop
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '0128 verify: % must be SECURITY DEFINER', f;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0128 verify: PUBLIC can execute %', f;
    end if;
    foreach r in array array['anon', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0128 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;
  foreach f in array v_sr loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0128 verify: % must be service_role only', f;
    end if;
  end loop;
  foreach f in array v_au loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0128 verify: % must be authenticated only', f;
    end if;
  end loop;
end $v$;
