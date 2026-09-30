// The /help/calendar "Questions" list — ONE array rendered twice by the help
// page: as the visible <dl> and as FAQPage JSON-LD. A question edited here
// changes both, so the visible text and the structured data cannot drift
// (the blog FAQ keeps its pairs in two places per file and has to be checked;
// this one does not).
//
// Answers are PLAIN TEXT: no markup, no markdown, no links — the same string
// goes into the JSON-LD `text`. The two "Can parents…" / "Does the calendar
// link work with Skylight…" entries are the calendar questions from the
// "Keep Your League Software" blog post, kept word-for-word with it.
//
// Nothing here may carry a token, a team name or a feed URL: the page is
// indexable and linked from the coach message.

export type HelpFaqEntry = { question: string; answer: string };

export const CALENDAR_HELP_FAQ: readonly HelpFaqEntry[] = [
  {
    question: "A game says CANCELLED. Is it rained out?",
    answer:
      "Yes — a cancelled game stays on your calendar, crossed out, rather than disappearing. If the league reschedules it, the same game moves to its new time.",
  },
  {
    question: "The link says it isn't recognized or was replaced.",
    answer:
      "The league issued a new link for your team. Ask your coach for the current one and add it the same way.",
  },
  {
    question: "Are playoff games included?",
    answer: "Not yet. Regular-season games only, for now.",
  },
  {
    question: "Who can see my team's schedule?",
    answer:
      "Anyone with the link — the same as a printed schedule. It contains team names, dates, times and fields, and nothing about players, coaches or families.",
  },
  {
    question: "Can I add it to a shared family calendar?",
    answer:
      "Add it on each person's account, or on the account your family shares. A subscribed calendar belongs to the account that added it.",
  },
  {
    question: "Can parents get the schedule on their phones?",
    answer:
      "Yes, on Pro and Elite. Every team gets its own calendar link once its division's schedule is locked. Families add it to Apple Calendar, Google Calendar, or Outlook once, and games stay current as the schedule changes, including moves and cancellations. Calendar apps check for updates on their own schedule, sometimes only every several hours, so same-day changes like rainouts should still come from the league too.",
  },
  {
    question: "Does the calendar link work with Skylight or other family calendars?",
    answer:
      "Yes. FieldSlate's team calendar link is a standard subscription link, so any calendar that can add a calendar by URL can use it. On a Skylight, open the Skylight app, go to Synced Calendars, choose Sync new calendar, then Calendar URL, and paste the team's https link. Game changes then flow to the family's wall calendar on Skylight's refresh schedule.",
  },
];

/** The FAQPage block, built from the same array the page lists. */
export function calendarHelpFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: CALENDAR_HELP_FAQ.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
