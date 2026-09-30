import type { Metadata } from "next";
import Link from "next/link";
import { CALENDAR_HELP_FAQ, calendarHelpFaqJsonLd } from "@/lib/calendar/help-faq";

// Public, static help page for parents and coaches: how to add a team's
// calendar link to each calendar app. Deliberately carries NO token and NO
// team data — it is linked from the coach message, so it must be safe to
// index and to forward. Keep the Google Calendar note: subscribing "from
// URL" only exists on the desktop site, and people otherwise try the phone
// app first and give up.
//
// The "Questions" section and its FAQPage JSON-LD both render from
// CALENDAR_HELP_FAQ (src/lib/calendar/help-faq.ts) — never write a question
// here directly, or the visible list and the structured data drift.

export const metadata: Metadata = {
  title: "Add your team's schedule to your calendar · FieldSlate",
  description:
    "How to add a FieldSlate team calendar link to iPhone, Google Calendar, Android, Outlook and Skylight, and what to expect when games change.",
};

function Step({ children }: { children: React.ReactNode }) {
  return <li className="pl-1 text-sm leading-relaxed text-gray-600">{children}</li>;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold text-[#0C1F3F]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function CalendarHelpPage() {
  return (
    <div className="bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(calendarHelpFaqJsonLd()) }}
      />
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Add your team&apos;s schedule to your calendar
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Your league sent you a calendar link for your team. Add it once and every game
            shows up in the calendar app you already use, and the games update themselves when
            the league moves one. The link looks like{" "}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">https://www.thefieldslate.com/calendar/…</code>{" "}
            or starts with <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">webcal://</code>.
          </p>
          <p className="mt-3 text-xs text-gray-500">
            Don&apos;t have a link? Ask your coach or league — it isn&apos;t on this page.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Same-day changes still come from the league.</p>
          <p className="mt-1 leading-relaxed">
            Calendar apps check for updates on their own schedule, not the moment something
            changes. Apple usually checks within a few hours; Google Calendar can take up to a
            day. So a rainout called at 2pm may not reach your phone before a 4pm game. Treat the
            calendar as your season overview, and the league&apos;s message as the word on today.
          </p>
        </div>

        <nav className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {[
            ["iphone", "iPhone & iPad"],
            ["google", "Google Calendar"],
            ["android", "Android"],
            ["outlook", "Outlook"],
            ["skylight", "Skylight"],
            ["faq", "Questions"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="font-medium text-[#22C55E] hover:underline">
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          <Section id="iphone" title="iPhone, iPad and Mac">
            <ol className="list-decimal space-y-2 pl-5">
              <Step>Tap the link that starts with <strong>webcal://</strong> in the message from your coach.</Step>
              <Step>Your phone opens the Calendar app and asks whether to subscribe. Tap <strong>Subscribe</strong>.</Step>
              <Step>Tap <strong>Done</strong>. The team&apos;s games now appear in your calendar.</Step>
            </ol>
            <p className="mt-3 text-sm text-gray-500">
              If tapping the link does nothing, copy the <strong>https://</strong> version instead and
              go to Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar,
              then paste it.
            </p>
          </Section>

          <Section id="google" title="Google Calendar">
            <p className="text-sm leading-relaxed text-gray-600">
              <strong>This has to be done from a computer</strong>, at calendar.google.com. The
              Google Calendar phone app can&apos;t add a calendar from a link. Once it&apos;s added
              on the computer, it shows up in the phone app on its own.
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <Step>On a computer, open <strong>calendar.google.com</strong> and sign in.</Step>
              <Step>In the left column, next to <strong>Other calendars</strong>, click the <strong>+</strong>.</Step>
              <Step>Choose <strong>From URL</strong>.</Step>
              <Step>Paste the <strong>https://</strong> link from your coach and click <strong>Add calendar</strong>.</Step>
              <Step>On your phone, open the Google Calendar app, go to Settings, tap your account, and make sure the new calendar is switched on.</Step>
            </ol>
            <p className="mt-3 text-sm text-gray-500">
              Google refreshes subscribed calendars on its own schedule, often several hours and
              sometimes up to a day. Changes will arrive; they just won&apos;t be instant.
            </p>
          </Section>

          <Section id="android" title="Android">
            <p className="text-sm leading-relaxed text-gray-600">
              Most Android phones use Google Calendar, so follow the Google Calendar steps above
              from a computer; the calendar then appears in the phone app. If you use Samsung
              Calendar or another app that&apos;s signed in with a Google account, the same applies.
            </p>
          </Section>

          <Section id="outlook" title="Outlook">
            <ol className="list-decimal space-y-2 pl-5">
              <Step>Open Outlook on the web (outlook.com or your Microsoft 365 account) and go to <strong>Calendar</strong>.</Step>
              <Step>Choose <strong>Add calendar</strong>, then <strong>Subscribe from web</strong>.</Step>
              <Step>Paste the <strong>https://</strong> link from your coach, give the calendar a name, and click <strong>Import</strong>.</Step>
            </ol>
            <p className="mt-3 text-sm text-gray-500">
              The Outlook desktop and phone apps pick up the calendar from your account. Outlook
              refreshes subscribed calendars on its own schedule, usually within a few hours.
            </p>
          </Section>

          <Section id="skylight" title="Skylight (family wall calendar)">
            <ol className="list-decimal space-y-2 pl-5">
              <Step>Open the <strong>Skylight app</strong>.</Step>
              <Step>Go to <strong>Synced Calendars</strong> → <strong>Sync new calendar</strong> → <strong>Calendar URL</strong>.</Step>
              <Step>Paste the <strong>https://</strong> link from your coach (not the webcal one).</Step>
            </ol>
            <p className="mt-3 text-sm text-gray-500">
              Games appear on the Skylight and update on Skylight&apos;s own refresh schedule.
            </p>
          </Section>

          <Section id="faq" title="Questions">
            <dl className="flex flex-col gap-4">
              {CALENDAR_HELP_FAQ.map(({ question, answer }) => (
                <div key={question}>
                  <dt className="text-sm font-semibold text-[#0C1F3F]">{question}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-gray-600">{answer}</dd>
                </div>
              ))}
            </dl>
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
