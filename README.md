# FieldSlate

Youth sports league scheduling SaaS — [www.thefieldslate.com](https://www.thefieldslate.com).

League commissioners create seasons, divisions, and teams; generate conflict-free game and practice schedules; manage venues, officials, interleague play, snack shacks, and pay tracking; and share schedules with coaches and families.

## Stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS**
- **Supabase** — Postgres with RLS on every table; SECURITY DEFINER RPCs for cap-enforced create paths
- **Vercel** — every push to `main` auto-deploys to production
- **Stripe** — checkout + webhook for paid plans (season-as-unit-of-sale)
- **Resend** — transactional email (schedule sends, invitations)

## Development & deploy

This is a production-only environment — there is no staging.

```bash
npm run dev          # local preview (.env.local required)
npx tsc --noEmit     # required before every commit
npx eslint <paths>   # required before every commit
git push origin main # deploys to production via Vercel
```

Database migrations live in `supabase/migrations/` (numbered `00NN_name.sql`) and are applied to the live project via the Supabase MCP/dashboard — the files in the repo are the record, not the applicator. Verify schema changes against the live catalog before writing code that depends on them.

## Data model — key concepts

- **`leagues` = seasons.** `archived_at IS NULL` means active. Archived seasons free their plan-cap slots.
- **`org_id` = the owner's profile id.** Resolve with `getCurrentOrgId()` (`src/lib/orgs/context.ts`). Multi-admin orgs share via `org_members`; membership checks go through the SECURITY DEFINER `is_org_member()` — never inline its logic.
- **`profiles.plan`** (`free | pro | elite`) is the canonical tier source. UI gating via `isProPlus`/`isElite` + `FeatureLockedCard`/`UpgradeModal`; cap enforcement lives in the create RPCs (`create_division_atomic`, `create_team`, `create_league`…), with matching UI counters in `src/lib/plan/counts.ts` — the two layers must agree.
- **Officials** (`umpires` + `official_*` tables): season-scoped roster with contact info, weekly availability windows, blackout dates, certifications, a coached-team link (`umpires.team_id`), and normalized season roles (`official_roles`). Role writes are dual-format during migration: free text in `game_umpires.role`/`umpire_role_rates.role` plus `role_id` → `official_roles`; `divisions.umpire_roles` jsonb stays populated until a future cleanup migration.
- **Auto-assign** (`src/lib/umpires/auto-assign.ts`) is best-effort and two-tier: fully-qualified first (availability, weekly cap, no blackout, no coach conflict, no overlap), then a soft tier that relaxes availability and weekly caps. Blackouts, coach conflicts, double-booking, and time overlap are always hard blocks. Division `priority` orders assignment. All of its date math is client-side local-timezone (`src/lib/umpires/eligibility.ts`) — do not call from server code without adding a timezone parameter.

## Codebase conventions

- `src/types/database.ts` is **hand-curated** — never regenerate it wholesale. Add new tables/columns surgically and keep the `Functions` map empty; RPC call sites rely on the `as never` convention.
- PostgREST `head: true` counts combined with `!inner` joins return wrong numbers — fetch ids first, then count with `.in()`. Plain single-table filtered counts are safe.
- Icons live at `app/icon.svg`, `apple-icon.png`, `opengraph-image.png` — do not add `metadata.icons`.
- Brand tokens: navy `#0b1c39`, paper `#f4f5f0`, green `#22c55e`, dark green `#16a34a`.
- Read existing components fully before writing new ones and match their patterns (inline `Loader2` busy states, `router.refresh()` after client writes, modal overlay structure, 44px tap targets on mobile surfaces).
