// Mutation pass for season-purchase-sim.ts — each mutant must fail FIRST at
// its own assertion (see mutant-runner.ts).
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/billing/season-purchase.ts";

const MUTANTS: Mutant[] = [
  {
    id: "PM1", what: "a comped league sent to checkout", file: LIB,
    find: "  if (s.comped) return \"create\";",
    replace: "  if (false && s.comped) return \"create\";",
    expect: "N",
  },
  {
    id: "PM2", what: "an unused credit ignored (a paid-for season bought twice)", file: LIB,
    find: "  if (s.creditCount > 0) return \"create\";",
    replace: "  if (false && s.creditCount > 0) return \"create\";",
    expect: "N",
  },
  {
    id: "PM3", what: "a Free league with its season active gets a free second one", file: LIB,
    find: "  if (s.plan === \"free\") return s.activeCount === 0 ? \"create\" : \"convert_free\";",
    replace: "  if (s.plan === \"free\") return \"create\";",
    expect: "N",
  },
  {
    id: "PM4", what: "a Free upgrade ignores whether a season is active", file: LIB,
    find: "  if (plan === \"free\") return activeCount > 0 ? \"convert_free\" : \"signup\";",
    replace: "  if (plan === \"free\") return \"convert_free\";",
    expect: "U",
  },
  {
    id: "PM5", what: "an Elite gate missing from ELITE_FEATURES", file: "src/lib/plan/limits.ts",
    find: "  { gates: [\"Snack Shack\"], lose: \"snack shack\" },\n",
    replace: "",
    expect: "LG1",
  },
  {
    id: "PM6", what: "the lose line drops the plan limits", file: LIB,
    find: "    `Partner leagues are limited to ${pro.interleagueOrgsPerSeason} per season ` +\n    `and admin seats to ${pro.admins}.`",
    replace: "    ``",
    expect: "L1",
  },
  {
    id: "PM7", what: "the flag checked after pending (a flagged payment reads as waiting)", file: LIB,
    find: "  if (row.needs_review && !row.league_id) return \"flagged\";\n  if (row.status === \"abandoned\") return \"abandoned\";\n  if (row.status === \"pending\") return elapsedMs >= SLOW_AFTER_MS ? \"slow\" : \"waiting\";",
    replace: "  if (row.status === \"abandoned\") return \"abandoned\";\n  if (row.status === \"pending\") return elapsedMs >= SLOW_AFTER_MS ? \"slow\" : \"waiting\";\n  if (row.needs_review && !row.league_id) return \"flagged\";",
    expect: "P",
  },
  {
    id: "PM7b", what: "a flagged purchase whose season exists reads as not created", file: LIB,
    find: "  if (row.needs_review && !row.league_id) return \"flagged\";",
    replace: "  if (row.needs_review) return \"flagged\";",
    expect: "P",
  },
  {
    id: "PM8", what: "the slow threshold off by one", file: LIB,
    find: "elapsedMs >= SLOW_AFTER_MS ? \"slow\" : \"waiting\"",
    replace: "elapsedMs > SLOW_AFTER_MS ? \"slow\" : \"waiting\"",
    expect: "P",
  },
  {
    id: "PM9", what: "the flagged page stops saying there's no second charge", file: LIB,
    find: "          \"You won’t be charged again.\",",
    replace: "",
    expect: "C",
  },
  {
    id: "PM10", what: "a flag reason loses its sentence", file: LIB,
    find: "    case \"plan_changed\":",
    replace: "    case \"plan_changed_x\":",
    expect: "R1",
  },
  {
    id: "PM11", what: "the review email's html not escaped", file: LIB,
    find: "    s.replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\");",
    replace: "    s;",
    expect: "E2",
  },
  {
    id: "PM12", what: "the date range drops the first year across New Year", file: LIB,
    find: "  const left = `${MONTHS[a.mo - 1]} ${a.d}${a.y !== b.y ? `, ${a.y}` : \"\"}`;",
    replace: "  const left = `${MONTHS[a.mo - 1]} ${a.d}`;",
    expect: "D",
  },
  {
    id: "PM13", what: "a price typed by hand on the pricing page", file: "src/components/marketing/pricing.tsx",
    find: "    price: priceLabel(\"pro\"),",
    replace: "    price: \"$249\",",
    expect: "PR1",
  },
  {
    id: "PM14", what: "a second caller of create_league", file: "src/components/seasons/purchase-status.tsx",
    find: "const POLL_MS = 2000;",
    replace: "const POLL_MS = 2000;\nexport const LEGACY_RPC = \"create_league\";",
    expect: "S2",
  },
  {
    id: "PM15", what: "the Seasons page opens the add-season modal again", file: "src/components/seasons/seasons-list-client.tsx",
    find: "import { UpgradeModal } from \"@/components/plan/upgrade-cta\";",
    replace: "import { UpgradeModal } from \"@/components/plan/upgrade-cta\";\nimport { SeasonUpgradeModal } from \"@/components/plan/UpgradeModal\";\nvoid SeasonUpgradeModal;",
    expect: "S3",
  },
  {
    id: "PM16", what: "a blog post's body states a price the config doesn't have",
    file: "content/blog/little-league-scheduling-software.md",
    find: "$249 or $349 per season for the paid tiers",
    replace: "$249 or $399 per season for the paid tiers",
    expect: "PR3",
  },
  {
    id: "PM17", what: "a blog post's FAQ frontmatter states a price the config doesn't have",
    file: "content/blog/league-scheduling-companion.md",
    find: "one active season. Paid tiers are $249 or $349 per season, not per player and not a subscription.\"",
    replace: "one active season. Paid tiers are $229 or $349 per season, not per player and not a subscription.\"",
    expect: "PR3",
  },
];

runMutants({ sim: "scripts/sim/season-purchase-sim.ts", mutants: MUTANTS });
