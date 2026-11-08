// The /help/volunteers "Questions" list — ONE array rendered twice by the
// help page: as the visible <dl> and as FAQPage JSON-LD, the same rule as
// src/lib/calendar/help-faq.ts. Edit a question here and both change.
//
// Answers are PLAIN TEXT: no markup, no markdown, no links — the same string
// goes into the JSON-LD `text`. Nothing here may carry a token, a league, a
// team or a volunteer's name: the page is public.
//
// Every fixed volunteer string lives under src/lib/volunteers so Spanish can
// be added later in one place.

export type HelpFaqEntry = { question: string; answer: string };

export const VOLUNTEER_HELP_FAQ: readonly HelpFaqEntry[] = [
  {
    question: "Who can see my name?",
    answer:
      "Only your league's administrators. Everyone else sees the spot as Taken.",
  },
  {
    question: "Can I take two spots at the same time?",
    answer:
      "The form warns you when your email already has a spot at an overlapping time. You can still take both.",
  },
  {
    question: "Who do the emails come from?",
    answer:
      "FieldSlate's address, with your league's name. Replies go to your league.",
  },
  {
    question: "When is my information deleted?",
    answer:
      "When your league archives the season. FieldSlate's privacy policy has the details.",
  },
  {
    question: "Can I sign up my child?",
    answer: "No. Volunteers must be 18 or older.",
  },
];

/** The FAQPage block, built from the same array the page lists. */
export function volunteerHelpFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: VOLUNTEER_HELP_FAQ.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
