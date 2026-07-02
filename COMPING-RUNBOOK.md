# FieldSlate — How to Comp a League (Runbook)

Give a league a free Elite account, safely, without the billing system
stepping on it.

Last updated: July 2026. If the billing schema changes (new columns, an admin
UI, a downgrade-on-refund handler), update this doc.

## The one thing to understand first

**Comping is two changes, not one.** Both must happen or the comp is unsafe:

1. **Set their plan to Elite** — `profiles.plan = 'elite'`. This is what
   actually gives them the tier.
2. **Turn on the comp guard** — `profiles.comped = true`. This shields the
   account so the Stripe billing path can't overwrite the comp or
   accidentally charge them.

If you do only #1, the account is Elite but unprotected — and unprotected
comped accounts have collided with Stripe before. Always do both.

## Before you comp anyone: the account must exist

You can only comp an account that has already signed up. You cannot pre-comp
someone.

So the sequence for a new league (e.g. Empire) is:

1. They sign up for a free account first (send them
   https://www.thefieldslate.com/signup).
2. They tell you the email they used — OR you find it once they've signed up.
3. Then you comp that email using the steps below.

For SRA, the account already exists (it's yours / the league's). Just confirm
you're comping the league's org-owner account, not your personal test account.

## The safety checks (do these every time)

Before running the comp, confirm all three:

- [ ] **The email is exactly right.** You're editing a live production table.
      A typo hits the wrong row or errors out.
- [ ] **The account owns an org.** The comp only helps if this profile
      actually owns a league/org — not if they're just a coach or member on
      someone else's. (Query below checks this.)
- [ ] **You've decided the tier.** Comps are normally Elite (the full
      free-founding-league offer). If you ever comp at Pro, swap `'elite'`
      for `'pro'` below.

## Method A — By hand in Supabase (fast, for one-offs)

Use this when you're comfortable and it's a single league.

**Step 1 — Look up the account and confirm it owns an org.**

Supabase Dashboard → SQL Editor → run (swap in the real email):

```sql
select p.id, p.email, p.plan, p.comped, l.id as owns_league
from profiles p
left join leagues l on l.owner_id = p.id
where p.email = 'THEIR_EMAIL_HERE';
```

If you get at least one row with a value in `owns_league` → good, they own an
org.

If `owns_league` is empty/null on every row → **STOP.** They don't own an org
yet. Don't comp until they've created their league, or you'll comp an account
that can't use the tier.

**Step 2 — Run the comp (both changes at once).**

```sql
update profiles
set plan = 'elite',
    comped = true
where email = 'THEIR_EMAIL_HERE';
```

**Step 3 — Read it back to confirm it stuck.**

```sql
select email, plan, comped
from profiles
where email = 'THEIR_EMAIL_HERE';
```

You want to see exactly: `plan = elite`, `comped = true`. Done.

## Method B — Via Claude Code (safer, matches your discipline)

Use this when you want the confirm-first, read-back-after rigor, or when
comping more than one at a time. Paste this prompt into a Claude Code session:

```text
Task: Comp a league to free Elite, safely. Investigate-confirm first, then
apply. Read the row back to prove it stuck. Plain-English completion report
with family-on-the-line scrutiny.

Target email: THEIR_EMAIL_HERE

Confirm before changing anything:
- Look up the profile by that email. Confirm exactly one profile matches.
- Confirm that profile owns at least one org (leagues.owner_id = profile.id).
  If it owns none, STOP and report — do not comp an account that owns no org.
- Report current plan and comped values before the change.

Apply (only after confirming the above):
- Set profiles.plan = 'elite' and profiles.comped = true for that email, in a
  single update.
- The update must be written so it affects only the one matching row and is
  safe (no error) if the email somehow doesn't match.

Verify:
- Re-read the row and report back email, plan, comped. Confirm plan = elite
  and comped = true.
- Confirm no other rows were touched.
```

## Reversing a comp (if a league leaves or a comp was a mistake)

Set them back to free and turn the guard off:

```sql
update profiles
set plan = 'free',
    comped = false
where email = 'THEIR_EMAIL_HERE';
```

Read it back the same way (Step 3 above) to confirm.

## Currently comped accounts (keep this list current)

Update this whenever you comp or un-comp someone, so there's one place that
tells the truth about who's free and why.

| Email | Tier | Why | Date |
|---|---|---|---|
| whitking10@gmail.com | Elite | Founder / dashboard owner | — |
| whitmellonking@gmail.com | Elite | Founder smoke-test account | — |
| whitking10+test2@gmail.com | Elite | Founder smoke-test account | — |
| jennifer.m.medici@gmail.com | Elite | Beta user | — |
| (add SRA org-owner email) | Elite | Founding league — Fall Ball | — |
| (add Empire org-owner email once they sign up) | Elite | Founding league — soccer | — |

## Gotchas & notes

- **Comp ≠ downgrade-on-refund.** Separate topic. Today nothing
  auto-downgrades a plan on a Stripe refund; that's a manual `plan = 'free'`
  fix (see reversing, above). Not relevant to comping, just don't confuse the
  two.
- **A comp persists forever until you manually reverse it.** There's no
  expiry on the account itself. (This is different from the INTERLEAGUE
  coupon, which does expire in late July 2027 — unrelated mechanism.)
- **`comped = true` is the shield.** As long as it's true, the webhook and
  checkout-start guards leave the account alone. Never set `plan = 'elite'`
  without also setting `comped = true` for a genuine comp.
- **No admin UI yet.** This is all SQL today. If you later build a "comp this
  league" button, replace Methods A/B with it and update this doc.
