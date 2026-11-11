// Assembles the 0130 proof: puts the LITERAL text of the migration where the
// placeholder is in official-game-change-sim.sql, and the mutant table where
// its placeholder is, and prints the batch. What gets proven is the file that
// will be applied, never a copy.
//
//   npx tsx scripts/sim/official-game-change-build.ts > proof.sql
//   npx tsx scripts/sim/official-game-change-build.ts --md5
//       every 0130 function's md5(prosrc), computed from the repo file — the
//       values the run and the live catalog after apply must show. Also the
//       method check: 0124's official_outbox_take and 0106's
//       record_game_played reproduce their live records.
//   npx tsx scripts/sim/official-game-change-build.ts regress0124 > proof.sql
//       the 0124 proof's assertions against 0130 (0124 is live, so 0130 is
//       applied where 0124 was). 0130 re-creates official_outbox_take, so the
//       one 0124 mutant inside it (MO12, the link token left in the reply →
//       OX1) is re-aimed at 0130's copy.
//   npx tsx scripts/sim/official-game-change-build.ts regress0106 > proof.sql
//       the 0106 proof against 0130: 0130 is applied where 0106 was, and
//       0106's mutants rewrite the live record_game_played (now 0130's). Its
//       fixtures move from the "SRALL" test org to the "test" org, and the
//       non-member (and the owner of the wrong-org field) becomes "Test 2"
//       (27c15406…, not a member of "test"), so nothing of SRALL's is
//       written, even rolled back.
//
// It only reads files and writes to stdout. It never connects to anything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0130@@";
const MUT_PLACEHOLDER = "    -- @@MUTANTS@@\n";
const QUOTE = "$mig130$";
const VERIFY = "-- 10. Verify";
const MIG_PATH = "supabase/migrations/0130_official_game_change_notices.sql";

const harness = readFileSync(join(ROOT, "scripts/sim/official-game-change-sim.sql"), "utf8");
const MIG = readFileSync(join(ROOT, MIG_PATH), "utf8");
const NOVER = MIG.split(VERIFY)[0];
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** name → prosrc (the text between the function's `$$`s). */
function bodies(sql: string, label: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^create or replace function public\.([a-z0-9_]+)\(/gm;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const open = sql.indexOf("$$", m.index);
    const close = sql.indexOf("$$", open + 2);
    if (open < 0 || close < 0) die(`no $$ body for ${m[1]}`);
    if (out.has(m[1])) die(`${m[1]} is defined twice in ${label}`);
    out.set(m[1], sql.slice(open + 2, close));
  }
  return out;
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

type Mutant = { id: string; expect: string; what: string; find: string; repl: string; find2?: string; repl2?: string };

// Each must die FIRST at its own tag.
export const MUTANTS: Mutant[] = [
  {
    id: "MG1", expect: "GC4", what: "the trigger's past-game skip removed",
    find: "    if (new.scheduled_at at time zone 'UTC')::timestamp <= public.official_org_now(v_owner)\n       and (old.scheduled_at at time zone 'UTC')::timestamp <= public.official_org_now(v_owner) then\n      return null;\n    end if;\n",
    repl: "",
  },
  {
    id: "MG2", expect: "GC2", what: "no coalescing (a row per game)",
    find: "           'changes:' || gu.umpire_id, now() + interval '10 minutes'\n",
    repl: "           null, now() + interval '10 minutes'\n",
  },
  {
    id: "MG3", expect: "GC3", what: "`was` overwritten by the latest change",
    find: "(excluded.payload -> 'changes') || coalesce(public.official_outbox.payload -> 'changes', '{}'::jsonb)),",
    repl: "coalesce(public.official_outbox.payload -> 'changes', '{}'::jsonb) || (excluded.payload -> 'changes')),",
  },
  {
    id: "MG4", expect: "GC3", what: "the net-change drop removed",
    find: "       and not (to_char((g.scheduled_at",
    repl: "       and not (false and to_char((g.scheduled_at",
  },
  {
    id: "MG5", expect: "GC5", what: "the Elite gate removed",
    find: "  select coalesce((select p.plan = 'elite' from public.profiles p where p.id = p_owner), false)\n",
    repl: "  select true\n",
  },
  {
    id: "MG6", expect: "GC5", what: "the confirmed-contact gate removed",
    find: "     and exists (select 1 from public.official_signup_settings s\n                  where s.owner_id = p_owner and s.contact_email is not null)\n",
    repl: "",
  },
  {
    id: "MG7", expect: "GC5", what: "notify_game_changes ignored",
    find: "     and coalesce((select s.notify_game_changes from public.official_signup_settings s\n                    where s.owner_id = p_owner), true);\n",
    repl: "     ;\n",
  },
  {
    id: "MG8", expect: "GC8", what: "the change trigger's handler re-raises",
    find: "    perform public.official_record_failure(new.league_id, new.id, sqlstate);\n",
    repl: "    perform public.official_record_failure(new.league_id, new.id, sqlstate);\n    raise;\n",
  },
  {
    id: "MG9", expect: "GC10", what: "the trigger unassigns an official with a problem",
    find: "    end if;\n    return null;\n  exception when others then\n",
    repl: "      delete from public.game_umpires gu where gu.game_id = new.id and public.official_move_problem(gu.umpire_id, new.id) is not null;\n    end if;\n    return null;\n  exception when others then\n",
  },
  {
    id: "MG10", expect: "GC9", what: "the re-check uses the full slot rule (always slot_taken)",
    find: "         and public.official_move_problem(gu.umpire_id, new.id) is not null\n",
    repl: "         and public.official_slot_problem(gu.umpire_id, new.id, gu.role, false) is not null\n",
  },
  {
    id: "MG11", expect: "KY1", what: "the take names the other officials on the game",
    find: "                'problem', public.official_move_problem(gu.umpire_id, g.id)) as j\n",
    repl: "                'problem', public.official_move_problem(gu.umpire_id, g.id),\n                'others', (select string_agg(u2.name, ', ') from public.game_umpires gx join public.umpires u2 on u2.id = gx.umpire_id where gx.game_id = g.id and gx.umpire_id <> gu.umpire_id)) as j\n",
  },
  {
    id: "MG12", expect: "P1", what: "the take granted to anon",
    find: "grant execute on function public.official_outbox_take(integer)                   to service_role;\n",
    repl: "grant execute on function public.official_outbox_take(integer)                   to service_role, anon;\n",
  },
  {
    id: "MG13", expect: "GC1", what: "status-only WHEN (misses field moves)",
    find: "  when (old.scheduled_at is distinct from new.scheduled_at\n        or old.venue_id is distinct from new.venue_id\n        or old.status is distinct from new.status)\n  execute function public.official_on_game_change();\n",
    repl: "  when (old.status is distinct from new.status)\n  execute function public.official_on_game_change();\n",
  },
  {
    id: "MG14", expect: "GC12", what: "the trigger ignores the skip setting",
    find: "  if current_setting('fieldslate.official_notice_skip', true) = 'on' then\n",
    repl: "  if false then\n",
  },
  {
    id: "MG15", expect: "GC13", what: "removed entries for past games",
    find: "  if (old.scheduled_at at time zone 'UTC')::timestamp <= public.official_org_now(v_owner) then\n    return old;\n  end if;\n",
    repl: "",
  },
  {
    id: "MG16", expect: "GC14", what: "the delete trigger swallows its errors",
    find: "  return old;\nend;\n$$;\n\ncreate trigger official_on_game_delete",
    repl: "  return old;\nexception when others then\n  return old;\nend;\n$$;\n\ncreate trigger official_on_game_delete",
  },
  {
    id: "MG17", expect: "GC12b", what: "the skip reset removed (it leaks to the rest of the transaction)",
    find: "  perform set_config('fieldslate.official_notice_skip', '', true);\n",
    repl: "",
  },
  {
    id: "MG18", expect: "SK1", what: "a callable function that sets any setting by name",
    find: "grant execute on function public.set_official_notify_game_changes(uuid, boolean) to authenticated;\n",
    repl: "grant execute on function public.set_official_notify_game_changes(uuid, boolean) to authenticated;\ncreate function public.set_notice_skip(p text) returns text language sql security definer set search_path = public as $x$ select set_config(p, 'on', true) $x$;\nrevoke execute on function public.set_notice_skip(text) from public;\ngrant execute on function public.set_notice_skip(text) to authenticated;\n",
  },
  {
    id: "MG19", expect: "GC15", what: "the re-check runs only on a time change (misses rainout removed)",
    find: "       and (not public.official_game_busy(old.status) or new.scheduled_at is distinct from old.scheduled_at) then\n",
    repl: "       and new.scheduled_at is distinct from old.scheduled_at then\n",
  },
  {
    id: "MG20", expect: "GC15b", what: "the re-check also runs on a rainout (both guards removed)",
    find: "    if public.official_game_busy(new.status)\n       and (not public.official_game_busy(old.status) or new.scheduled_at is distinct from old.scheduled_at) then\n",
    repl: "    if true then\n",
    find2: "  if v_start is null or not public.official_game_busy(v_status) then\n",
    repl2: "  if v_start is null then\n",
  },
  {
    id: "MG20b", expect: "GC15b", what: "official_move_problem's busy guard removed (a rained-out entry carries a problem)",
    find: "  if v_start is null or not public.official_game_busy(v_status) then\n",
    repl: "  if v_start is null then\n",
  },
  {
    id: "MG21", expect: "GC4b", what: "the send-time past drop removed",
    find: "       and (g.scheduled_at at time zone 'UTC')::timestamp > now_.t\n       and not (",
    repl: "       and not (",
  },
  {
    id: "MG22", expect: "GC6", what: "no_email never fails the row",
    find: "  update public.official_outbox o set status = 'failed', error = 'no_email'\n",
    repl: "  update public.official_outbox o set status = 'failed', error = 'no_email'\n   where false and o.id is null;\n  update public.official_outbox o set status = o.status\n",
  },
];

if (count(harness, PLACEHOLDER) !== 1) die("Expected the migration placeholder exactly once in the harness.");
if (count(harness, MUT_PLACEHOLDER) !== 1) die("Expected the mutant placeholder exactly once in the harness.");
if (MIG.includes(QUOTE)) die(`The migration contains ${QUOTE}, which would end the harness's quoting early.`);
if (count(harness, QUOTE) !== 2) die(`Expected ${QUOTE} exactly twice in the harness.`);
if (count(MIG, VERIFY) !== 1) die("0130 must contain the verify marker exactly once.");

/** Each mutant's find text matches the migration (before the verify block) exactly once. */
export function staleMutants(): string[] {
  const out: string[] = [];
  for (const m of MUTANTS) {
    if (count(NOVER, m.find) !== 1) out.push(`${m.id} find matches ${count(NOVER, m.find)} times`);
    if (m.find2 !== undefined && count(NOVER, m.find2) !== 1) out.push(`${m.id} find2 matches ${count(NOVER, m.find2)} times`);
  }
  return out;
}

const lit = (s: string) => {
  if (s.includes("$r$")) die("a mutant contains $r$");
  return `$r$${s}$r$`;
};

const mode = process.argv[2] ?? "";

if (mode === "--md5") {
  const take124 = bodies(readFileSync(join(ROOT, "supabase/migrations/0124_officials_signup.sql"), "utf8"), "0124").get("official_outbox_take");
  const rgp106 = bodies(readFileSync(join(ROOT, "supabase/migrations/0106_record_game_played.sql"), "utf8"), "0106").get("record_game_played");
  if (!take124 || !rgp106) die("method check: a body is missing");
  console.log(`method check: 0124 official_outbox_take → ${md5(take124)}`);
  console.log(`method check: 0106 record_game_played → ${md5(rgp106)}`);
  for (const [name, body] of [...bodies(MIG, "0130")].sort(([a], [b]) => a.localeCompare(b))) console.log(`${name}=${md5(body)}`);
  process.exit(0);
}

const stale = staleMutants();
if (stale.length) die(`STALE mutants:\n${stale.join("\n")}`);

if (mode === "regress0124") {
  let h = readFileSync(join(ROOT, "scripts/sim/official-signup-sim.sql"), "utf8");
  const cut = h.indexOf("\ndo $h$");
  if (cut < 0 || h.indexOf("\ndo $h$", cut + 1) >= 0) die("official-signup-sim.sql: expected exactly one \"do $h$\" driver block");
  h = h.slice(0, cut);
  const MO12 = { id: "MO12", expect: "OX1", find: "           'payload', t.payload - 'token',", repl: "           'payload', t.payload," };
  if (count(NOVER, MO12.find) !== 1) die(`regress0124 MO12: find text matches 0130 ${count(NOVER, MO12.find)} times (want 1)`);
  process.stdout.write(`${h}

-- ── the 0124 proof against 0130 (official-game-change-build.ts regress0124) ──
do $h$
declare
  v_body  text := ${QUOTE}
${MIG}
${QUOTE};
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\\n';
  m       record;
begin
  v_nover := split_part(v_body, '${VERIFY}', 1);
  begin
    execute v_body;
    v_res := pg_temp.h124_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\\n';
    raise exception 'HREGROLLBACK';
  exception when others then
    if sqlerrm <> 'HREGROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\\n';
    end if;
  end;
  for m in
    select * from (values
    ('${MO12.id}', '${MO12.expect}', ${lit(MO12.find)}, ${lit(MO12.repl)})
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h124_case();
      raise exception 'HREGCASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'HREGCASE:%' then replace(sqlerrm, 'HREGCASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — the 0124 proof against 0130\\n%', v_out;
end $h$;
`);
  process.exit(0);
}

if (mode === "regress0106") {
  const H106 = readFileSync(join(ROOT, "scripts/sim/record-game-played-sim.sql"), "utf8");
  const P106 = "-- @@MIGRATION_0106@@";
  if (count(H106, P106) !== 1) die("record-game-played-sim.sql: expected its placeholder exactly once");
  if (MIG.includes("$mig106$")) die("0130 contains $mig106$");
  const SRALL = "aa21d01c-66dc-4c37-b15c-7b743c557eea";
  const TEST = "bbf9afe1-9e62-41e0-becc-895085bfc9d6";
  const TEST2 = "27c15406-fdda-43ce-bc31-1a071fe254e4";
  if (count(H106, SRALL) < 1 || count(H106, TEST) < 1 || H106.includes(TEST2)) die("record-game-played-sim.sql: org ids not as expected");
  const swapped = H106.split(TEST).join(TEST2).split(SRALL).join(TEST);
  if (swapped.includes(SRALL)) die("regress0106: SRALL's id survived the swap");
  process.stdout.write(
    `-- regress0106: the 0106 proof with 0130 applied in its place; fixtures in the "test" org.\n` +
      swapped.replace(P106, () => MIG),
  );
  process.exit(0);
}

if (mode !== "") die(`unknown mode ${mode}`);

const rows = MUTANTS.map(
  (m) =>
    `    ('${m.id}', '${m.expect}', ${lit(m.find)}, ${lit(m.repl)}, ${m.find2 === undefined ? "null" : lit(m.find2)}, ${m.repl2 === undefined ? "null" : lit(m.repl2)}),\n`,
).join("");
process.stdout.write(harness.replace(PLACEHOLDER, () => MIG).replace(MUT_PLACEHOLDER, () => rows));
