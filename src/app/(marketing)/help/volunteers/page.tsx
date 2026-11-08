import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import { VOLUNTEER_HELP_FAQ, volunteerHelpFaqJsonLd } from "@/lib/volunteers/help-faq";

// Public, static help page for families: how volunteer sign-ups work. Carries
// NO token and NO league, team or volunteer data.
//
// NOINDEX AND NOT IN THE SITEMAP UNTIL VOLUNTEER SIGN-UPS LAUNCH TO REAL
// LEAGUES (decided 2026-11-08): the feature is behind a per-org switch, so
// search must not send people to something their league can't use. At
// launch: drop `robots` below and add the URL to src/app/sitemap.ts.
//
// The "Questions" section and its FAQPage JSON-LD both render from
// VOLUNTEER_HELP_FAQ (src/lib/volunteers/help-faq.ts) — never write a
// question here directly.

export const metadata: Metadata = {
  title: "Sign up to volunteer for your league · FieldSlate",
  description:
    "How FieldSlate volunteer sign-ups work: picking a spot, your private link, changing or canceling, and what happens when a game moves.",
  alternates: { canonical: `${SITE_URL}/help/volunteers` },
  robots: { index: false, follow: false },
};

function Step({ children }: { children: React.ReactNode }) {
  return <li className="pl-1 text-sm leading-relaxed text-gray-600">{children}</li>;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold text-[#0C1F3F]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-gray-600">{children}</p>;
}

export default function VolunteerHelpPage() {
  return (
    <div className="bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(volunteerHelpFaqJsonLd()) }}
      />
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Sign up to volunteer for your league
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Your league shared a sign-up link. Pick a spot, enter your name and email, and
            you&apos;re done. We&apos;ll email you a confirmation with a private link for
            changing your plans.
          </p>
          <p className="mt-3 text-xs text-gray-500">
            Don&apos;t have a link? Ask your league. It isn&apos;t on this page.
          </p>
        </div>

        <nav className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {[
            ["signing-up", "Signing up"],
            ["private-link", "Your private link"],
            ["changing", "Changing or canceling"],
            ["game-moves", "If a game moves"],
            ["faq", "Questions"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="font-medium text-[#22C55E] hover:underline">
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          <Section id="signing-up" title="Signing up">
            <ol className="list-decimal space-y-2 pl-5">
              <Step>Open the sign-up link from your league.</Step>
              <Step>Choose your division, then your team.</Step>
              <Step>Pick an open spot. Spots marked <strong>Taken</strong> are already filled.</Step>
              <Step>Enter your first initial, last name and email, and confirm you&apos;re 18 or older.</Step>
              <Step>Tap <strong>Sign up</strong>. Check your email for the confirmation.</Step>
            </ol>
            <Para>
              Some snack shack shifts name a team, like <strong>For Mets families</strong>. Those
              are set aside for that team&apos;s families. Shifts without a team are open to
              anyone.
            </Para>
            <Para>
              If someone takes the spot a moment before you, you&apos;ll see &ldquo;Just taken,
              pick another.&rdquo;
            </Para>
          </Section>

          <Section id="private-link" title="Your private link">
            <Para>
              Your confirmation email has a private link to your spots. Anyone with the link can
              change or cancel them, so don&apos;t forward it. If you lose it, ask your league to
              send a new one. The old link stops working when a new one is sent.
            </Para>
          </Section>

          <Section id="changing" title="Changing or canceling">
            <Para>
              Use your private link to switch to another spot or cancel, up to 24 hours before
              your spot. Closer than that, the page shows your league&apos;s email. Contact the
              league directly so they can find a replacement.
            </Para>
          </Section>

          <Section id="game-moves" title="If a game moves or is rained out">
            <Para>
              Your spot moves with the game, and we email you the new time so you can keep it or
              cancel. If a game is rained out, your spot is held, and we email you when the makeup
              date is set. If the rainout is called off, we email you that the game is back on.
            </Para>
            <Para>
              A spot marked <strong>May move</strong> is on a game whose time is being worked out
              with another league.
            </Para>
          </Section>

          <Section id="faq" title="Questions">
            <dl className="flex flex-col gap-4">
              {VOLUNTEER_HELP_FAQ.map(({ question, answer }) => (
                <div key={question}>
                  <dt className="text-sm font-semibold text-[#0C1F3F]">{question}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-gray-600">{answer}</dd>
                </div>
              ))}
            </dl>
            <Para>
              <Link href="/privacy#volunteers" className="font-medium text-[#22C55E] hover:underline">
                Read how FieldSlate handles volunteer information
              </Link>
            </Para>
          </Section>
        </div>

        <div className="mt-12 border-t border-gray-100 pt-6 text-center">
          <Link href="/" className="text-sm text-gray-500 transition-colors hover:text-[#0C1F3F]">
            &larr; FieldSlate home
          </Link>
        </div>
      </div>
    </div>
  );
}
