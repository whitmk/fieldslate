// Harness for ROW_ICON_REVEAL (src/components/ui/row-icon-reveal.ts) — row
// icons always visible on touch screens, unchanged on pointer devices.
//
// HOW. Compiles the class strings with the REAL Tailwind config
// (tailwind.config.ts, including its `can-hover` variant) through Tailwind's
// own PostCSS plugin, then resolves the effective `opacity` and `color` of a
// row icon for four states — {pointer device, touch device} × {row hovered,
// not hovered} — with a small cascade: a rule applies if its media condition
// holds and its selector matches the state; the winner is highest specificity,
// then latest in source order. Only the rule shapes Tailwind emits for these
// classes are modelled (plain class, `.group:hover .x`, `@media (hover: hover)`);
// anything else THROWS rather than being silently skipped.
//
// THE GOLDEN is the cloud's pre-change class string, verbatim. Pointer-device
// states must resolve identically under the old and new classes ([P1]–[P2]);
// touch states must become visible ([T1]–[T2]).
//
// ANTI-VACUITY: counts the compiled rules that actually matched in each
// environment; a zero means the evaluator saw nothing and proved nothing.
//
// ── MUTATION LOG (2026-09-25) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   TV1  ROW_ICON_REVEAL reverted to plain opacity-0 (touch invisible) → [T1]
//   TV2  pointer colour class dropped (pointer turns grey-400)         → [P1]
//   TV3  touch colour left at grey-200 (visible but unreadable)        → [T2]
//   TV4  group-hover dropped (pointer never reveals on hover)          → [P2]
// RESULT: 4/4 killed, each FIRST at its own assertion.
// NOTE: the first TV2 made the `can-hover` variant unconditional ("&"). It died
// at [T1], not [P1] — correctly, because it leaves pointer rendering genuinely
// unchanged and only breaks touch. It was a touch mutant mislabelled as a
// pointer one, so it was replaced by the two pointer mutants TV2 and TV4.

import postcss from "postcss";
import tailwindcss from "tailwindcss";
import tailwindConfig from "../../tailwind.config";
import { ROW_ICON_REVEAL } from "@/components/ui/row-icon-reveal";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// The rainout cloud's icon classes BEFORE 2026-09-25, minus the classes both
// versions share (layout/hover-colour/disabled), which the swap didn't touch.
const GOLDEN_OLD = "text-gray-200 opacity-0 group-hover:opacity-100";

type Env = { canHover: boolean; rowHovered: boolean };
type Rule = { selector: string; media: string | null; decls: Map<string, string>; order: number };

async function compile(classes: string): Promise<Rule[]> {
  const html = `<div class="group"><button class="${classes}"></button></div>`;
  const result = await postcss([
    tailwindcss({ ...tailwindConfig, content: [{ raw: html, extension: "html" }] }),
  ]).process("@tailwind utilities;", { from: undefined });
  const rules: Rule[] = [];
  let order = 0;
  result.root.walkRules((r) => {
    const parent = r.parent;
    let media: string | null = null;
    if (parent && parent.type === "atrule") {
      const at = parent as postcss.AtRule;
      if (at.name !== "media") throw new Error(`unmodelled at-rule @${at.name}`);
      media = at.params.replace(/\s+/g, "");
    }
    const decls = new Map<string, string>();
    r.walkDecls((d) => {
      decls.set(d.prop, d.value);
    });
    rules.push({ selector: r.selector, media, decls, order: order++ });
  });
  return rules;
}

function unescape(cls: string) {
  return cls.replace(/\\/g, "");
}

/** Does `selector` match the icon in `env`? Returns specificity, or null. */
function matches(selector: string, iconClasses: Set<string>, env: Env): number | null {
  // `.group:hover .group-hover\:x`
  const gh = selector.match(/^\.group:hover \.(\S+)$/);
  if (gh) {
    if (!env.rowHovered) return null;
    return iconClasses.has(unescape(gh[1])) ? 30 : null;
  }
  // plain `.cls`
  // (class names may carry Tailwind's escaped colon, e.g. `can-hover\:x`)
  const CLS = String.raw`((?:\\.|[^\s:\\])+)`;
  const plain = selector.match(new RegExp(`^\\.${CLS}$`));
  if (plain) return iconClasses.has(unescape(plain[1])) ? 10 : null;
  // `.cls:hover` / `.cls:disabled` — the ICON's own pseudo states, which this
  // harness holds un-hovered and enabled: never match.
  if (new RegExp(`^\\.${CLS}:(hover|disabled)$`).test(selector)) return null;
  throw new Error(`unmodelled selector: ${selector}`);
}

function mediaHolds(media: string | null, env: Env): boolean {
  if (media === null) return true;
  if (media === "(hover:hover)") return env.canHover;
  throw new Error(`unmodelled media: ${media}`);
}

const hits = { pointer: 0, touch: 0 };

function resolve(rules: Rule[], classes: string, env: Env) {
  const iconClasses = new Set(classes.split(/\s+/).filter(Boolean));
  const winner: Record<string, { spec: number; order: number; value: string }> = {};
  for (const r of rules) {
    if (!mediaHolds(r.media, env)) continue;
    const spec = matches(r.selector, iconClasses, env);
    if (spec === null) continue;
    hits[env.canHover ? "pointer" : "touch"]++;
    for (const [prop, value] of r.decls) {
      if (prop !== "opacity" && prop !== "color") continue;
      const cur = winner[prop];
      if (!cur || spec > cur.spec || (spec === cur.spec && r.order > cur.order)) {
        winner[prop] = { spec, order: r.order, value };
      }
    }
  }
  return {
    opacity: winner.opacity?.value ?? "1",
    color: winner.color?.value ?? "(inherited)",
  };
}

async function main() {
  console.log("\nrow-icon-reveal sim");
  const oldRules = await compile(GOLDEN_OLD);
  const newRules = await compile(ROW_ICON_REVEAL);
  const s = (canHover: boolean, rowHovered: boolean): Env => ({ canHover, rowHovered });

  for (const hovered of [false, true]) {
    const o = resolve(oldRules, GOLDEN_OLD, s(true, hovered));
    const n = resolve(newRules, ROW_ICON_REVEAL, s(true, hovered));
    ok(
      o.opacity === n.opacity && o.color === n.color,
      `[P${hovered ? 2 : 1}] pointer device, row ${hovered ? "hovered" : "not hovered"}: unchanged from before`,
      `old=${JSON.stringify(o)} new=${JSON.stringify(n)}`,
    );
  }
  const pRest = resolve(newRules, ROW_ICON_REVEAL, s(true, false));
  ok(pRest.opacity === "0", "[P3] pointer device, not hovered: still hidden", JSON.stringify(pRest));

  const tRest = resolve(newRules, ROW_ICON_REVEAL, s(false, false));
  ok(tRest.opacity === "1", "[T1] touch device: the icon is VISIBLE without hover", JSON.stringify(tRest));
  const pColor = resolve(newRules, ROW_ICON_REVEAL, s(true, true)).color;
  ok(
    tRest.color !== pColor && /156 163 175/.test(tRest.color),
    "[T2] touch device: grey-400, not the near-invisible grey-200",
    JSON.stringify({ touch: tRest.color, pointer: pColor }),
  );
  const oldTouch = resolve(oldRules, GOLDEN_OLD, s(false, false));
  ok(oldTouch.opacity === "0", "[T3] the golden really WAS invisible on touch (the bug existed)");

  ok(hits.pointer > 0, "[AV] rules matched on the pointer device", `got ${hits.pointer}`);
  ok(hits.touch > 0, "[AV] rules matched on the touch device", `got ${hits.touch}`);
  console.log("  rule matches:", JSON.stringify(hits));
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
