-- Proof for 0132 (revoke PUBLIC EXECUTE on six trigger / event-trigger functions).
--
-- Assemble with scripts/sim/trigger-fn-execute-build.ts --case <a|b|c|d|e1|e2>:
-- it puts the LITERAL text of supabase/migrations/0132_… where the placeholder is
-- (a mutated copy for e1/e2). Each case is ONE batch that ends in a raise, so the
-- whole batch — migration included — always rolls back. The raise carries the
-- results out. Fixtures: the "test" org (owner bbf9afe1…), season "QA Fall 2026",
-- game cb6f39ee… in Rookies. Never Santa Rosa American Little League.
--
-- Locks while a case runs (all rolled back): (a) row locks on auth.users,
-- profiles, organization_members; (b) one games row and one divisions row
-- (+ the triggers' own writes: outboxes, stale marks, calendar links);
-- (c) a new table in public; (d) the event trigger and function rows. The
-- migration itself takes no table lock.
--
-- (a) as postgres, which OWNS handle_new_user and keeps EXECUTE: postgres can't
--     act as supabase_auth_admin and has no grant option on auth.users, so a
--     no-EXECUTE sign-up can't be staged here. (b) is the no-EXECUTE proof: the
--     game write runs as `authenticated`, which holds EXECUTE on none of them.
--
-- RUN LOG
--   2026-11-24 ~19:27 UTC, against production, every case rolled back, 0132 NOT
--   applied. File md5 0fc84d1ddc69ee3bdf77c9ddbfe9f633.
--   Build fault first: the assembler used a STRING replacement, which turns
--   every "$$" in the migration into "$" (JS replace patterns). Caught by reading
--   the assembled batch before sending; fixed with function replacers plus a
--   check that the batch contains the body verbatim. Nothing was sent broken.
--   a  green: profile + owner org-member row created by handle_new_user; after
--      the revoke only postgres holds EXECUTE (anon, authenticated, service_role,
--      dashboard_readonly, supabase_auth_admin all false).
--   b  green, as `authenticated` (EXECUTE false on all four): unlocked — notes,
--      notes_updated_at/by (test owner), updated_at (txn now) set, scheduled_at
--      +1h, posted true → false; locked — home_score refused "division_locked:
--      Rookies is locked …", note write allowed and attributed.
--   c  green: new public table has RLS on; ensure_rls enabled; anon EXECUTE false.
--   d  green: with ensure_rls and rls_auto_enable dropped the migration completes;
--      set_updated_at proconfig {search_path=""}. (A missing dashboard_readonly
--      role is NOT exercised: dropping a role in production isn't worth it.)
--   e1 KILLED at the assertion: "0132: anon still holds EXECUTE on
--      public.set_updated_at()".
--   e2 KILLED at the assertion: "0132: authenticated still holds EXECUTE on
--      public.handle_new_user()".
--   Leak check: all six ACLs / proconfig / md5(prosrc) as before, ensure_rls
--   enabled, no probe table, no scratch user or profile, game cb6f39ee… and
--   division Rookies unchanged, no games trigger disabled, no idle-in-transaction
--   backends.
--   APPLIED 2026-11-24 19:54 UTC on Whit's go, catalog 20261124195450, verbatim
--   (catalog statements md5 = the file, 0fc84d1ddc69ee3bdf77c9ddbfe9f633); the
--   migration's own assertion passed in the apply. Whit's throwaway sign-up at
--   19:58 UTC created its profile and owner org-member row. After: proacl
--   {postgres=X/postgres} on all six; anon, authenticated, service_role,
--   dashboard_readonly, supabase_auth_admin EXECUTE false; md5(prosrc)
--   unchanged on all six; set_updated_at proconfig {search_path=""}; the
--   security advisor names none of the six and has no search_path warning.

-- ==== CASE a ====
-- @@MIGRATION_0132@@
create temp table zz0132 (ord serial, step text, v jsonb);
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000132', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'zz-0132-proof@example.invalid',
        '{"full_name":"0132 proof","org_name":"0132 proof org"}'::jsonb, now(), now());
insert into zz0132 (step, v) select 'A1 profile', to_jsonb(p) - 'avatar_url'
  from profiles p where p.id = '00000000-0000-4000-8000-000000000132';
insert into zz0132 (step, v) select 'A2 org member', to_jsonb(m)
  from organization_members m where m.user_id = '00000000-0000-4000-8000-000000000132';
insert into zz0132 (step, v) select 'A3 EXECUTE on handle_new_user',
  jsonb_object_agg(r, has_function_privilege(r, 'public.handle_new_user()', 'execute'))
  from unnest(array['anon','authenticated','service_role','dashboard_readonly','supabase_auth_admin','postgres']) r;
do $$ begin raise exception 'PROOF a: %', (select jsonb_agg(jsonb_build_object(step, v) order by ord) from zz0132); end $$;

-- ==== CASE b ====
-- @@MIGRATION_0132@@
create temp table zz0132 (ord serial, step text, v jsonb);
grant all on zz0132 to authenticated;
grant usage on sequence zz0132_ord_seq to authenticated;
insert into zz0132 (step, v) select 'B0 authenticated EXECUTE',
  jsonb_object_agg(f, has_function_privilege('authenticated', 'public.' || f, 'execute'))
  from unnest(array['clear_division_posted()','enforce_division_lock()','set_games_notes_attribution()','set_updated_at()']) f;
update divisions set posted = true, posted_at = now() where id = 'b34adef4-89c1-4eb7-9fca-ff6f3d0788ea';
insert into zz0132 (step, v) select 'B1 before', jsonb_build_object(
  'scheduled_at', g.scheduled_at, 'notes', g.notes, 'notes_updated_at', g.notes_updated_at,
  'notes_updated_by', g.notes_updated_by, 'updated_at', g.updated_at, 'posted', d.posted, 'txn_now', now())
  from games g, divisions d where g.id = 'cb6f39ee-9914-401a-972f-074aaa1469cb' and d.id = 'b34adef4-89c1-4eb7-9fca-ff6f3d0788ea';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbf9afe1-9e62-41e0-becc-895085bfc9d6","role":"authenticated"}', true);
update games set notes = '0132 proof', scheduled_at = scheduled_at + interval '1 hour'
  where id = 'cb6f39ee-9914-401a-972f-074aaa1469cb';
insert into zz0132 (step, v) select 'B2 rows updated as authenticated', to_jsonb(count(*))
  from games where id = 'cb6f39ee-9914-401a-972f-074aaa1469cb' and notes = '0132 proof';
reset role;
insert into zz0132 (step, v) select 'B3 after (unlocked)', jsonb_build_object(
  'scheduled_at', g.scheduled_at, 'notes', g.notes, 'notes_updated_at', g.notes_updated_at,
  'notes_updated_by', g.notes_updated_by, 'updated_at', g.updated_at, 'posted', d.posted)
  from games g, divisions d where g.id = 'cb6f39ee-9914-401a-972f-074aaa1469cb' and d.id = 'b34adef4-89c1-4eb7-9fca-ff6f3d0788ea';
update divisions set locked = true where id = 'b34adef4-89c1-4eb7-9fca-ff6f3d0788ea';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbf9afe1-9e62-41e0-becc-895085bfc9d6","role":"authenticated"}', true);
do $$
begin
  begin
    update games set home_score = 1 where id = 'cb6f39ee-9914-401a-972f-074aaa1469cb';
    insert into zz0132 (step, v) values ('B4 locked: score write', '"ALLOWED (wrong)"');
  exception when others then
    insert into zz0132 (step, v) values ('B4 locked: score write', to_jsonb('refused: ' || sqlerrm));
  end;
  update games set notes = '0132 proof, locked' where id = 'cb6f39ee-9914-401a-972f-074aaa1469cb';
  insert into zz0132 (step, v) values ('B5 locked: note write', '"allowed"');
end $$;
reset role;
insert into zz0132 (step, v) select 'B6 after (locked)', jsonb_build_object(
  'notes', g.notes, 'home_score', g.home_score, 'notes_updated_by', g.notes_updated_by)
  from games g where g.id = 'cb6f39ee-9914-401a-972f-074aaa1469cb';
do $$ begin raise exception 'PROOF b: %', (select jsonb_agg(jsonb_build_object(step, v) order by ord) from zz0132); end $$;

-- ==== CASE c ====
-- @@MIGRATION_0132@@
create table public.zz_0132_probe (id int);
do $$ begin raise exception 'PROOF c: %', jsonb_build_object(
  'C1 rls on new table', (select relrowsecurity from pg_class where oid = 'public.zz_0132_probe'::regclass),
  'C2 ensure_rls enabled', (select evtenabled from pg_event_trigger where evtname = 'ensure_rls'),
  'C3 anon EXECUTE on rls_auto_enable', has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')); end $$;

-- ==== CASE d ====
drop event trigger ensure_rls;
drop function public.rls_auto_enable();
-- @@MIGRATION_0132@@
do $$ begin raise exception 'PROOF d: completed; rls_auto_enable present=%; set_updated_at config=%',
  to_regprocedure('public.rls_auto_enable()') is not null,
  (select proconfig from pg_proc where oid = 'public.set_updated_at()'::regprocedure); end $$;

-- ==== CASE e1 ====
-- mutant: the build inserts `grant execute on function public.set_updated_at() to anon;`
-- just before the assertion. Expected: 0132: anon still holds EXECUTE on public.set_updated_at()
-- @@MIGRATION_0132@@
do $$ begin raise exception 'PROOF e1: MUTANT SURVIVED (assertion did not raise)'; end $$;

-- ==== CASE e2 ====
-- mutant: the build removes handle_new_user() from the REVOKE loop's array only.
-- Expected: 0132: <a role> still holds EXECUTE on public.handle_new_user()
-- @@MIGRATION_0132@@
do $$ begin raise exception 'PROOF e2: MUTANT SURVIVED (assertion did not raise)'; end $$;
