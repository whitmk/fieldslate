# Orphan `day_windows` — production snapshot, 2026-09-23

A record of every orphan game-day window that existed in production **before**
the wizard toggle leak was fixed. An orphan is a key in
`divisions.settings.day_windows` that is NOT in that division's
`settings.playing_days` — hours for a day the division does not play.

**Why this file exists.** Cleanup of these rows is a separate decision, and once
it happens the evidence is gone. One orphan (SRALL Majors, Sunday 10:00–18:00)
carries hours a person actually typed; the other fourteen are the wizard's
untouched 09:00–17:00 default. Nothing in the product distinguishes the two, so
the distinction only survives if it is written down.

**Cause.** `toggleGameDay` in `src/components/divisions/steps/step-playing-schedule.tsx`
removed a day from `playing_days` but left its window behind. New divisions seed
`playing_days: ["Sa","Su"]` with a window for each (`wizard-types.ts`), so every
Saturday-only division created through the wizard acquired a Sunday orphan.
Fixed on branch `fix/wizard-orphan-windows`; NO data migration was written.

**Impact at the time of capture: none.** Every reader of `day_windows` checks
`playing_days` membership first, so orphans were inert. They were misleading,
not harmful: a forgotten window is indistinguishable from a deliberate one.

## The 15 orphans (11 of 30 divisions)

Captured with a read-only query against the live database on 2026-09-23.

| Org | Season | Division | Division id | Day | Hours | Plays | Archived |
|---|---|---|---|---|---|---|---|
| Santa Rosa American Little League | SRALL - Fall 2026 | 50/70 | `cbb8dab8-b079-4344-bc18-291713c2afc5` | Su | 09:00–17:00 | Sa | no |
| Santa Rosa American Little League | SRALL - Fall 2026 | Majors | `018709c3-8edc-4674-9758-ef961ad7a24f` | Su | **10:00–18:00** | Sa | no |
| Santa Rosa American Little League | SRALL - Fall 2026 | Minors | `a76897be-5607-4599-a260-54a654ea1986` | Su | 09:00–17:00 | Sa | no |
| Santa Rosa American Little League | SRALL - Fall 2026 | Rookies | `998a5c55-4f13-477f-9a76-16164bee24e5` | Su | 09:00–17:00 | Sa | no |
| Santa Rosa American Little League | SRALL - Fall 2026 | T-Ball | `27570442-f09f-4f0d-ab0a-46c7c957d23f` | Su | 09:00–17:00 | Sa | no |
| SRALL | Fall 2026 | AA | `0dba9eaf-28aa-461a-99b8-def9a4a47180` | Su | 09:00–17:00 | Sa, We | no |
| Test 2 | Retest Season | PassDiv | `d90841d2-23f7-4c9e-b6b3-cafa66a733a2` | Sa | 09:00–17:00 | Tu, Th | no |
| Test 2 | Retest Season | PassDiv | `d90841d2-23f7-4c9e-b6b3-cafa66a733a2` | Su | 09:00–17:00 | Tu, Th | no |
| SRALL | QA Season 2026-05-19 | QA-AA | `c89502d5-b890-4779-8ee8-f35c40d72f54` | Sa | 09:00–17:00 | Mo, We, Fr | yes |
| SRALL | QA Season 2026-05-19 | QA-AA | `c89502d5-b890-4779-8ee8-f35c40d72f54` | Su | 09:00–17:00 | Mo, We, Fr | yes |
| SRALL | QA Season 2026-05-19 | QA-Majors | `0842c584-5127-4747-afe2-297f9f180e1c` | Sa | 09:00–17:00 | Mo, We, Fr | yes |
| SRALL | QA Season 2026-05-19 | QA-Majors | `0842c584-5127-4747-afe2-297f9f180e1c` | Su | 09:00–17:00 | Mo, We, Fr | yes |
| SRALL | QA Season 2026-05-19 | QA-TBall | `d0025759-006c-49f7-b96f-d9719ae7e1b1` | Sa | 09:00–17:00 | Mo, We, Fr | yes |
| SRALL | QA Season 2026-05-19 | QA-TBall | `d0025759-006c-49f7-b96f-d9719ae7e1b1` | Su | 09:00–17:00 | Mo, We, Fr | yes |
| SRALL | SRALL | AAA | `1f46019b-e6ac-4d2c-8c9e-a35059681add` | Fr | 09:00–17:00 | Sa, Tu, We, Th | yes |

Seasons (`leagues.id`): SRALL - Fall 2026 `a34d79e8-0a3f-4549-b620-282d7e8e76f3`
· Fall 2026 `b921214d-ef2d-41c8-8331-ca6597c57d20` · Retest Season
`2363a2be-e25d-4f8f-89e9-c04b8c6b9362` · QA Season 2026-05-19
`ae73dab4-bc58-4948-8b0a-d1c77c4ced15` · SRALL (archived)
`de87fbb9-e271-4cdf-9ba3-74269b6156c1`.

**Also captured, both clean:** `leagues.schedule_settings` (one season,
Valley Baseball League, has season-wide settings — no orphans) and the
`playoffs` table (3 rows, no orphans; its wizard carried the same leak and was
fixed preventively).

## The query that produced this

```sql
select dv.id as division_id, dv.name as division, l.name as season,
       coalesce(p.org_name, '(no org name)') as org,
       (l.archived_at is not null) as archived,
       k as orphan_day,
       dv.settings->'day_windows'->k->>'start' as start,
       dv.settings->'day_windows'->k->>'end' as "end",
       dv.settings->>'playing_days' as playing_days
from divisions dv
  join leagues l on l.id = dv.league_id
  left join profiles p on p.id = l.owner_id,
  jsonb_object_keys(
    case when jsonb_typeof(dv.settings->'day_windows') = 'object'
         then dv.settings->'day_windows' else '{}'::jsonb end
  ) k
where not (coalesce(dv.settings->'playing_days', '[]'::jsonb) ? k)
order by archived, org, season, division, k;
```

Re-run it to see what is left after any cleanup. The fix stops NEW orphans; it
does not remove these, and a re-save of an untouched division deliberately
preserves them byte for byte.
