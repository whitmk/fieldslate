// Homepage testimonial: one founding league's season, in numbers and in the
// reviewer's own words. Sits directly below the Hero (navy) and above
// Features (white), so it is gray-50 to keep the page's alternating rhythm.
// Server component — no client JS; the optional "Read the full review" is a
// native <details>.
//
// THE QUOTES ARE THE REVIEWER'S WORDS EXACTLY. Do not edit them, including
// the em dash and the exclamation mark. Only the heading and subline are ours.
//
// Colors are the homepage's hex literals (#0C1F3F, #22C55E, #16a34a), not the
// fs-* tokens, to match the neighbouring sections.

import { Quote } from "lucide-react";

// Attribution confirmed by the reviewer 2026-10-02.
const ATTRIBUTION_NAME = "Jenn M.";
const ATTRIBUTION_ROLE = "Santa Rosa American Little League, Scheduler";

const DISCLOSURE = "Founding league — received FieldSlate free during its first season.";

const QUOTE =
  "Sounds like a scheduler's nightmare — but with FieldSlate it was an absolute breeze! What would have taken painstaking days was a series of questions that considers all the little things.";

const SECOND_LINE = "No more time suck spreadsheets. It's all here in one cute little package.";

// The complete review, verbatim, one paragraph per entry. Rendered under the
// "Read the full review" toggle with whitespace-pre-line, so each entry is a
// line on its own.
const FULL_REVIEW = [
  "THE BEST PART OF OUR LITTLE LEAGUE SEASON WAS FIELDSLATE!",
  "259 games. 6 leagues. 54 teams. 9 venues. 11 weeks.",
  "Sounds like a scheduler's nightmare — but with FieldSlate it was an absolute breeze!",
  "User-friendly season set up + well-thought out magic and Voila! What would have taken painstaking days was a series of questions that considers all the little things: field prep timelines, game times by division, field access, team/coach availability, and type of play.",
  "MVP features that I didn't know I needed, but now can't live without: rainouts/reschedules that identifies remaining field availability, ridiculously simple interleague features, game schedules as PDFs and export to digital calendars, snack shack/umpire sign ups by venue, multi-user access, and top-level season reports.",
  "No more time suck spreadsheets. It's all here in one cute little package. Buckle up, FieldSlate will take your scheduling to the next level.",
].join("\n");

const STATS: { value: string; label: string }[] = [
  { value: "259", label: "games" },
  { value: "6", label: "leagues" },
  { value: "54", label: "teams" },
  { value: "9", label: "venues" },
  { value: "11", label: "weeks" },
];

export function Testimonial() {
  return (
    <section id="testimonial" className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            One league&apos;s season, start to finish
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Santa Rosa American Little League scheduled a full season on FieldSlate.
            Here is what it took, and what their scheduler said.
          </p>
        </div>

        {/* Stat strip. Five items; 3 columns below sm so a 375px phone shows
            two rows (3 + 2) with no sideways scroll, 5 across from sm up. */}
        <ul
          aria-label="The season by the numbers"
          className="mx-auto mt-12 grid max-w-4xl grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-5 sm:gap-x-6"
        >
          {STATS.map(({ value, label }) => (
            <li key={label} className="flex flex-col items-center text-center">
              <span className="text-4xl font-bold tabular-nums tracking-tight text-[#0C1F3F] sm:text-5xl">
                {value}
              </span>
              <span className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500 sm:text-sm">
                {label}
              </span>
            </li>
          ))}
        </ul>

        <figure className="mx-auto mt-14 max-w-3xl text-center">
          <Quote aria-hidden="true" className="mx-auto h-8 w-8 text-[#22C55E]" />
          <blockquote className="mt-5">
            <p className="text-xl font-medium leading-relaxed text-[#0C1F3F] sm:text-2xl">
              &ldquo;{QUOTE}&rdquo;
            </p>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              &ldquo;{SECOND_LINE}&rdquo;
            </p>
          </blockquote>
          <figcaption className="mt-8">
            <p className="text-sm font-semibold text-[#0C1F3F]">{ATTRIBUTION_NAME}</p>
            <p className="mt-0.5 text-sm text-gray-600">{ATTRIBUTION_ROLE}</p>
            <p className="mt-1 text-xs text-gray-400">{DISCLOSURE}</p>
          </figcaption>

          <details className="mt-8">
            <summary className="inline-block cursor-pointer text-sm font-medium text-[#16a34a] underline underline-offset-2 hover:text-[#0C1F3F]">
              Read the full review
            </summary>
            <div className="mt-4 whitespace-pre-line text-left rounded-2xl border border-gray-100 bg-white p-6 text-base leading-7 text-gray-600">
              {FULL_REVIEW}
            </div>
          </details>
        </figure>
      </div>
    </section>
  );
}
