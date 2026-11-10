# Compare table — the five new rows, checked 2026-11-09

Source rule: each vendor's own site and help center only (no review sites, no
memory). "Unverified" means the vendor's pages don't settle it — it is NOT a
"no". These rows are NOT in `src/lib/compare-data.ts` yet: the table only has
yes / partial / no, and most cells below would have to be guessed.

Rows: (1) Volunteer sign-ups tied to games · (2) Sign-ups move when a game
moves · (3) Volunteer goal tracking per family · (4) Officials pick open games
themselves · (5) Officials count toward family goals. FieldSlate: yes on all
five (Elite).

| Competitor | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| PlayMetrics | unverified | unverified | unverified | unverified | unverified |
| SportsEngine (PlayMetrics) | partial | unverified | partial | no* | unverified |
| TeamSnap | yes† | unverified | unverified | yes‡ / unverified | unverified |
| LeagueApps | partial | unverified | unverified | unverified | unverified |
| TeamLinkt | partial | unverified | unverified | unverified (leans no) | unverified |
| Jersey Watch | partial | unverified | unverified (leans no) | unverified | unverified |
| TeamSideline | partial | unverified | unverified | yes | unverified |
| Diamond Scheduler | no | no | no | unverified (leans no) | no |
| LeagueLobster | no | no | no | unverified (leans no) | no |
| Assignr | no | no | no | yes | no |

\* From a SportsEngine blog post dated 2023-09-15 ("no Officials Assignment
tool is integrated"); over two years old.
† Team-level "Assignments" on a specific game or event, paid plans.
‡ Self-assignment is documented for TeamSnap Tournaments, not Clubs & Leagues.

Row 2 ("Sign-ups move when a game moves") is unverified for EVERY competitor
that has volunteer sign-ups — no vendor page says what happens on a reschedule.
help.playmetrics.com, support.leagueapps.com and support.teamsideline.com block
automated fetches; opening their pages in a browser could firm up those cells.

## Sources (one per cell that isn't "unverified")

- SportsEngine 1: help.sportsengine.com/en/articles/6323433-how-to-create-dibs-items (Dibs items have their own shift date, linked to Sessions, not games)
- SportsEngine 3: sportsengine.com/hq/features/volunteers/ ("meet their assigned number of hours each season"; tracked per account/session)
- SportsEngine 4: sportsengine.com/blog/recap-kickstart-your-move-sportsengine-hq/
- TeamSnap 1: helpme.teamsnap.com/article/387-create-team-assignments
- TeamSnap 4: helpme.teamsnap.com/article/423-manage-officiating-opportunities
- LeagueApps 1: support.leagueapps.com/hc/en-us/articles/360039863233 (volunteer registers as program staff)
- TeamLinkt 1: teamlinkt.com/solutions/for-clubs-and-associations; help.teamlinkt.com/en/articles/5138174-manage-tasks
- Jersey Watch 1: jerseywatch.com/blog/volunteer-signup-form-template ("rather than a dedicated volunteer module")
- TeamSideline 1: go.teamsideline.com/player-registration ("Custom shift creation"; not tied to games)
- TeamSideline 4: go.teamsideline.com/officials-management ("Allow officials to self-assign")
- Diamond Scheduler 1–3, 5: cactusware.com feature list (no volunteer module)
- LeagueLobster 1–3, 5: scheduler.leaguelobster.com and /pricing/ (no volunteer module)
- Assignr 1–3, 5: assignr.com feature pages (officials only); 4: support.assignr.com/en/articles/8526494-using-self-assign

## Noticed in passing (existing rows, not changed)

The live table says TeamSnap "Umpire assignments: no" and TeamSideline
"Umpire assignments: no"; TeamSideline's officials-management page and
TeamSnap Tournaments' officiating pages describe officials features. Worth a
re-check of those existing cells.
