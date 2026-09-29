-- 0098: a signed-in user can no longer write their own plan, comp flag or
-- promo code.
--
-- THE HOLE (confirmed against the live catalog 2026-09-29). `authenticated`
-- held table-level UPDATE on public.profiles; the only UPDATE policy is
-- "auth.uid() = id" with no column restriction; and profiles had no triggers.
-- So any signed-in user could, from the browser, set on their OWN row:
--   plan           → every Pro/Elite gate in the app trusts this column
--   comped         → "billing must never touch this row"
--   pending_promo  → re-armed after each purchase, the promo rides every one
--   pending_plan, role, email, id, created_at, updated_at
-- RLS decides WHICH ROWS a user may update. It never decided which COLUMNS.
--
-- THE FIX, two independent layers:
--   1. COLUMN PRIVILEGES. Table-level UPDATE is revoked; UPDATE is granted
--      back on exactly the four columns the app edits with the user's own
--      client. A column added to profiles later is NOT writable by users
--      until a migration says so.
--   2. A BEFORE UPDATE TRIGGER that refuses a change to any other column when
--      the caller is `authenticated` or `anon`. Belt and braces: if a future
--      migration re-grants table-level UPDATE by mistake, this still holds.
--
-- THE FOUR EDITABLE COLUMNS, and who writes them today:
--   org_name         Settings → organization name   (org-name-card.tsx)
--   setup_dismissed  /api/setup/dismiss
--   full_name        no app writer today; a user's own display name
--   avatar_url       no app writer today; a user's own avatar
-- The list appears TWICE below — the grant and the trigger's array. They must
-- stay identical; the verification block checks the grant side against the
-- live catalog and the harness pins the trigger side.
--
-- WHO STILL WRITES THE PROTECTED COLUMNS, and why each still works:
--   handle_new_user()        INSERT, not UPDATE — this trigger never fires
--                            and column UPDATE grants do not apply.
--   process_checkout_event() SECURITY DEFINER, owned by postgres: inside it
--                            current_user is `postgres`, not the caller.
--   the comping runbook      run in the SQL editor as `postgres`.
-- service_role holds no UPDATE on profiles and never did (0070 granted it
-- SELECT only); the webhook changes a plan through the function above.
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc) of
-- protect_profiles_columns() against this file after applying.
--
-- LOCKS when applied: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on profiles
-- (blocks writes to profiles, not reads) until the transaction ends.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Column privileges
-- ────────────────────────────────────────────────────────────────────────────
-- PUBLIC and anon hold no UPDATE today; they are revoked anyway so this
-- migration states the whole rule rather than relying on what it found.
revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;

grant update (full_name, avatar_url, org_name, setup_dismissed)
  on table public.profiles
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The trigger
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER — AND IT MUST STAY THAT WAY. The whole check is "who is
-- the caller", read from current_user. As SECURITY DEFINER this function
-- would run as its owner, current_user would always be `postgres`, and the
-- trigger would allow everything while looking exactly the same.
--
-- The column test is SUBTRACTION-based (the 0082 lock trigger's rule): it
-- compares the row with the editable columns removed. A column added to
-- profiles next year is therefore protected BY DEFAULT. Never rewrite this as
-- a list of protected columns.
--
-- A write that names a protected column without changing it (plan = plan) is
-- not a change and is not refused here; the column privileges refuse it.
create or replace function public.protect_profiles_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_editable constant text[] := array[
    'full_name', 'avatar_url', 'org_name', 'setup_dismissed'
  ];
  v_changed text;
begin
  -- Only the two roles a browser can act as are restricted. SECURITY DEFINER
  -- functions (run as their owner), the SQL editor (postgres) and
  -- service_role all pass.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if (to_jsonb(old) - v_editable) is distinct from (to_jsonb(new) - v_editable) then
    select string_agg(o.key, ', ' order by o.key)
      into v_changed
      from jsonb_each(to_jsonb(old) - v_editable) as o
      join jsonb_each(to_jsonb(new) - v_editable) as n on n.key = o.key
     where o.value is distinct from n.value;

    raise exception
      'profiles_protected_column: % cannot be changed from a signed-in session.',
      coalesce(v_changed, 'a protected column')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_profiles_columns
  before update on public.profiles
  for each row
  execute function public.protect_profiles_columns();

-- A trigger function is never called directly; nobody needs EXECUTE on it.
revoke execute on function public.protect_profiles_columns()
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Verify — RAISES if the privileges are not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
-- Walks EVERY column profiles has at apply time, so a column this file did
-- not anticipate is checked too.
do $$
declare
  r          record;
  v_editable constant text[] := array[
    'full_name', 'avatar_url', 'org_name', 'setup_dismissed'
  ];
  v_wrong    text := '';
  v_seen     integer := 0;
  v_col      text;
begin
  for r in
    select column_name::text as col
      from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
  loop
    v_seen := v_seen + 1;
    if has_column_privilege('authenticated', 'public.profiles', r.col, 'UPDATE')
       <> (r.col = any (v_editable))
    then
      v_wrong := v_wrong || format(' [authenticated %s]', r.col);
    end if;
    if has_column_privilege('anon', 'public.profiles', r.col, 'UPDATE') then
      v_wrong := v_wrong || format(' [anon %s]', r.col);
    end if;
  end loop;

  if v_seen < 13 then
    v_wrong := v_wrong || format(' [only %s columns seen — expected at least 13]', v_seen);
  end if;

  -- The columns this migration exists for, named, so a rename cannot make
  -- the loop above pass by no longer finding them.
  foreach v_col in array array['plan', 'comped', 'pending_promo', 'pending_plan', 'role', 'email', 'id']
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = v_col
    ) then
      v_wrong := v_wrong || format(' [column %s not found]', v_col);
    elsif has_column_privilege('authenticated', 'public.profiles', v_col, 'UPDATE') then
      v_wrong := v_wrong || format(' [authenticated can still update %s]', v_col);
    end if;
  end loop;

  -- has_table_privilege reports the TABLE-level grant only.
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     or has_table_privilege('anon', 'public.profiles', 'UPDATE')
  then
    v_wrong := v_wrong || ' [table-level UPDATE still held by authenticated or anon]';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'protect_profiles_columns'
       and t.tgenabled = 'O'
       and not p.prosecdef
  ) then
    v_wrong := v_wrong || ' [trigger missing, disabled, or its function is SECURITY DEFINER]';
  end if;

  if v_wrong <> '' then
    raise exception '0098 verification failed:%', v_wrong;
  end if;
end;
$$;
