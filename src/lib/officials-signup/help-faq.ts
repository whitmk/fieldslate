// The /help/officials-signup "Questions" list — ONE array rendered twice by
// the help page: as the visible <dl> and as FAQPage JSON-LD, the same rule as
// src/lib/calendar/help-faq.ts and src/lib/volunteers/help-faq.ts. Edit a
// question here and both change.
//
// Answers are PLAIN TEXT: no markup, no markdown, no links — the same string
// goes into the JSON-LD `text`. Nothing here may carry a token, a league or an
// official's name: the page is public. Every answer must stay true to the
// privacy policy's "Officials sign-up" section and to 0124's rules (drop until
// 48 hours before, a new link ends the old one, the daily digest).

export type HelpFaqEntry = { question: string; answer: string };

export const OFFICIALS_HELP_FAQ: readonly HelpFaqEntry[] = [
  {
    question: "Who can see my link?",
    answer:
      "Anyone who has it can take or drop spots for you, so keep it private. If it gets shared, ask your league for a new one; the old one stops working.",
  },
  {
    question: "Why can't I take a spot?",
    answer:
      "The page gives the reason from your own details: your availability, blackout dates, another game at that time, or your weekly limit.",
  },
  {
    question: "Can I drop a spot?",
    answer:
      "Yes, a spot you took yourself, until 48 hours before the game. After that, the page shows how to reach your league.",
  },
  {
    question: "Why don't I see every division?",
    answer: "Your league chooses which divisions you work.",
  },
  {
    question: "I'm under 18. Who gets the emails?",
    answer: "Your parent or guardian, at the address your league entered.",
  },
  {
    question: "Who do the emails come from?",
    answer: "FieldSlate's address, with your league's name. Replies go to your league.",
  },
  {
    question: "Does my league know when I take a spot?",
    answer:
      "Yes. Your league gets one email a day listing the spots officials took, and an email right away when someone drops one.",
  },
];

/** The FAQPage block, built from the same array the page lists. */
export function officialsHelpFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: OFFICIALS_HELP_FAQ.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
