// sim:home-faq — the homepage FAQ's two readers agree with their one source.
//
// HOME_FAQ (src/lib/marketing/home-faq.ts) is the only copy of the homepage
// Q&As. The visible section (faq.tsx) and the FAQPage JSON-LD
// (homeFaqJsonLd) both render from it. This checks:
//   H1  the JSON-LD has every entry, in order, word for word
//   H2  answers are plain text (no markup, no unfilled template, no -1 limit)
//   H3  the price and limit answers carry the config's values
//   H4  wiring: faq.tsx reads HOME_FAQ and types no Q&A text of its own;
//       the homepage renders <Faq /> and serializes homeFaqJsonLd
// A zero entries-compared counter fails the run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOME_FAQ } from "../../src/lib/marketing/home-faq";
import { homeFaqJsonLd } from "../../src/lib/marketing/structured-data";
import { priceLabel } from "../../src/lib/billing/prices";
import { PLAN_LIMITS } from "../../src/lib/plan/limits";

const ROOT = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

let passed = 0;
const failures: string[] = [];
function check(tag: string, ok: boolean, detail: string) {
  if (ok) passed++;
  else failures.push(`[${tag}] ${detail}`);
}
let entriesCompared = 0;

// H1 — JSON-LD matches the list exactly.
check("H1", homeFaqJsonLd["@type"] === "FAQPage", `@type is ${homeFaqJsonLd["@type"]}`);
check(
  "H1",
  homeFaqJsonLd.mainEntity.length === HOME_FAQ.length,
  `JSON-LD has ${homeFaqJsonLd.mainEntity.length} questions, the list has ${HOME_FAQ.length}`,
);
HOME_FAQ.forEach((entry, i) => {
  const q = homeFaqJsonLd.mainEntity[i];
  check("H1", q?.["@type"] === "Question", `item ${i + 1} is not a Question`);
  check("H1", q?.name === entry.question, `item ${i + 1} question differs: ${q?.name}`);
  check(
    "H1",
    q?.acceptedAnswer?.["@type"] === "Answer" && q?.acceptedAnswer?.text === entry.answer,
    `item ${i + 1} answer differs`,
  );
  entriesCompared++;
});
check(
  "H1",
  new Set(HOME_FAQ.map((e) => e.question)).size === HOME_FAQ.length,
  "two entries share a question",
);

// H2 — plain text only.
for (const { question, answer } of HOME_FAQ) {
  for (const text of [question, answer]) {
    check("H2", !/[<>*`]|\]\(|\$\{|undefined|NaN|\b-1\b/.test(text), `not plain text: ${text}`);
    check("H2", text.trim() === text && text.length > 0, `empty or padded: "${text}"`);
  }
}

// H3 — numbers come from the config.
const answerTo = (q: string) => HOME_FAQ.find((e) => e.question === q)?.answer ?? "";
const cost = answerTo("How much does it cost?");
check("H3", cost.includes(`Pro is ${priceLabel("pro")} per season`), `Pro price missing: ${cost}`);
check("H3", cost.includes(`Elite is ${priceLabel("elite")} per season`), `Elite price missing: ${cost}`);
check("H3", cost.includes(`up to ${PLAN_LIMITS.free.teamsPerOrg} teams`), `Free team cap missing: ${cost}`);
const il = answerTo("Can it schedule interleague games with other leagues?");
check(
  "H3",
  il.includes(`up to ${PLAN_LIMITS.pro.interleagueOrgsPerSeason} partner leagues`),
  `Pro partner cap missing: ${il}`,
);

// H4 — wiring.
const section = read("src/components/marketing/faq.tsx");
check("H4", /import \{ HOME_FAQ \} from "@\/lib\/marketing\/home-faq"/.test(section), "faq.tsx does not import HOME_FAQ");
check("H4", /HOME_FAQ\.map\(/.test(section), "faq.tsx does not render HOME_FAQ");
for (const { question } of HOME_FAQ) {
  check("H4", !section.includes(question), `faq.tsx types a question by hand: ${question}`);
}
const page = read("src/app/page.tsx");
check("H4", /<Faq \/>/.test(page), "the homepage does not render <Faq />");
check("H4", /JSON\.stringify\(homeFaqJsonLd\)/.test(page), "the homepage does not serialize homeFaqJsonLd");

check("V", entriesCompared > 0, "no entries compared — the check ran on nothing");

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`home-faq: ${passed} passed, ${failures.length} failed.`);
  process.exit(1);
}
console.log(`home-faq: ${passed} checks passed, 0 failed (entries compared: ${entriesCompared}).`);
