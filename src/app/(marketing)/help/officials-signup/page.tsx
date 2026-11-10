import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import { OFFICIALS_HELP_FAQ, officialsHelpFaqJsonLd } from "@/lib/officials-signup/help-faq";
import { MoreHelp } from "@/components/marketing/more-help";

// Public, static help page for officials: how officials sign-up works. Carries
// NO token and NO league, game or official data. Indexed and in the sitemap
// (launched 2026-11-09).
//
// The "Questions" section and its FAQPage JSON-LD both render from
// OFFICIALS_HELP_FAQ (src/lib/officials-signup/help-faq.ts) — never write a
// question here directly.

export const metadata: Metadata = {
  title: "Sign up for games as a league official · FieldSlate",
  description:
    "How FieldSlate officials sign-up works: your private link, taking and dropping open spots, and the emails you and your league get.",
  alternates: { canonical: `${SITE_URL}/help/officials-signup` },
};

export default function OfficialsSignupHelpPage() {
  return (
    <div className="bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(officialsHelpFaqJsonLd()) }}
      />
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Sign up for games as a league official
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Your league sent you a private link. It shows your games and the open spots you can
            take. Tap a spot to take it.
          </p>
        </div>

        <section id="faq" className="mt-10 scroll-mt-24">
          <h2 className="text-xl font-bold text-[#0C1F3F]">Questions</h2>
          <dl className="mt-3 flex flex-col gap-4">
            {OFFICIALS_HELP_FAQ.map(({ question, answer }) => (
              <div key={question}>
                <dt className="text-sm font-semibold text-[#0C1F3F]">{question}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-gray-600">{answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <MoreHelp current="/help/officials-signup" />

        <div className="mt-6 border-t border-gray-100 pt-6 text-center">
          <Link href="/" className="text-sm text-gray-500 transition-colors hover:text-[#0C1F3F]">
            &larr; FieldSlate home
          </Link>
        </div>
      </div>
    </div>
  );
}
