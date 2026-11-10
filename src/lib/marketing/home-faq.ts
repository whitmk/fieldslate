// THE homepage FAQ: one list, two readers. The visible section
// (src/components/marketing/faq.tsx) and the FAQPage JSON-LD (homeFaqJsonLd in
// structured-data.ts) both render from HOME_FAQ, so what readers see and what
// search engines see cannot drift (the blog's two-copies problem — see
// CLAUDE.md "Blog"). `npm run sim:home-faq` checks the JSON-LD against this
// list.
//
// Answers are PLAIN TEXT: no markdown, no HTML. Prices come from priceLabel
// and plan limits from PLAN_LIMITS — never type either here (sim:season-purchase
// PR1 scans this file, comments included).

import { priceLabel } from "@/lib/billing/prices";
import { PLAN_LIMITS } from "@/lib/plan/limits";

export type HomeFaqEntry = { question: string; answer: string };

export const HOME_FAQ: readonly HomeFaqEntry[] = [
  {
    question: "What is FieldSlate?",
    answer:
      "League operations software for volunteer-run youth leagues like Little League. It builds your game and practice schedule around your fields, checks every game for conflicts, and handles rainouts and interleague games. It also assigns umpires, builds snack shack shifts from the game schedule, runs volunteer sign-ups and runs playoff brackets, all in one connected system.",
  },
  {
    question: "Does FieldSlate replace our registration platform?",
    answer:
      "No. Keep PlayMetrics, Sports Connect or whatever your league uses for registration and payments. FieldSlate runs everything after registration: the schedule, officials, snack shack and volunteers.",
  },
  {
    question: "Does it work alongside PlayMetrics or Sports Connect?",
    answer:
      "Yes. Your league keeps registering players where it does today and builds the schedule in FieldSlate. Families can follow the schedule through a calendar feed, and you can export league data as CSV.",
  },
  {
    question: "What personal information does FieldSlate collect?",
    answer:
      "No player information, ever: no names, birthdates or contact details. FieldSlate doesn't need coach or parent details to build a schedule, and doesn't ask for them. The personal details it keeps are entered by your league's admins: their own sign-in name and email and, if you use these features, officials' names (with an optional email or phone for sending schedules), snack shack cash handlers' names, and a contact for each partner league. If your league uses volunteer sign-ups, the families who sign up enter a first initial, last name and email.",
  },
  {
    question: "Does FieldSlate use AI to build schedules?",
    answer:
      "No. Schedules come from rules your league sets: game days, field hours, blackout dates and team limits. The same settings always give the same result, and your league's data isn't sent to AI tools.",
  },
  {
    question: "How much does it cost?",
    answer: `Free covers one season with one division and up to ${PLAN_LIMITS.free.teamsPerOrg} teams. Pro is ${priceLabel("pro")} per season and Elite is ${priceLabel("elite")} per season, with no monthly fees. You pay only for the seasons you run.`,
  },
  {
    question: "Can it schedule interleague games with other leagues?",
    answer: `Yes. Pro includes interleague scheduling with up to ${PLAN_LIMITS.pro.interleagueOrgsPerSeason} partner leagues per season, and Elite has no limit.`,
  },
  {
    question: "What happens when a game gets rained out?",
    answer:
      "Pro and Elite include a rainout rescheduler. It helps you find a makeup slot that doesn't conflict with other games or field times, so rainouts don't get forgotten.",
  },
  {
    question: "What happens to volunteers when a game is rained out?",
    answer:
      "Their spots are held. When you set the makeup date, each volunteer gets an email with the new time and a link to keep the spot or cancel. Volunteer sign-ups are part of Elite.",
  },
  {
    question: "Do we still need SignUpGenius?",
    answer:
      "Not for game-day volunteers or snack shack. Families sign up from one FieldSlate link, every spot is tied to a real game or shift, and when a game moves the spot moves with it and the volunteer is emailed. Volunteer sign-ups are part of Elite.",
  },
  {
    question: "Can umpires sign themselves up?",
    answer:
      "Yes. Auto-assign fills games by availability. When there are gaps, send a help email and officials pick open games from their own private link. The same conflict and availability checks apply either way. Officials sign-up is part of Elite.",
  },
];
