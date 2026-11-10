// Homepage Features: the five areas of league operations (positioning doc
// 2026-11-10), so a visitor sees the whole system before the details.
// gray-50: it sits between "One change. Everyone knows." (white) and
// How it works (navy).
//
// Officials: auto-assign checks availability, blackouts, weekly caps,
// conflicts and the divisions each official works — NOT certifications or
// "qualifications" (eligibility.ts / claim-rules.ts). Keep the card to what
// it checks.

import { CalendarRange, ClipboardList, ShieldCheck, Store, Trees } from "lucide-react";

type Feature = {
  icon: typeof Store;
  area: string;
  title: string;
  description: string;
  /** The whole card is Elite: an "Elite" tag beside the area label. */
  elite?: boolean;
  /** An "Elite" tag right after the description (officials self-pick).
   *  Auto-assign is Elite too, so the tag closes the whole sentence. */
  eliteInline?: boolean;
};

const features: Feature[] = [
  {
    icon: CalendarRange,
    area: "Games",
    title: "Schedules without field conflicts",
    description:
      "Build every division's season with automatic field-conflict checks, interleague games, rainout rescheduling and playoff brackets.",
  },
  {
    icon: Trees,
    area: "Practices",
    title: "Practice fields, planned",
    description:
      "Plan how many fields to request and which nights, then schedule practices around games.",
  },
  {
    icon: ShieldCheck,
    area: "Officials",
    title: "Umpires on every game",
    description:
      "Auto-assign by availability and the divisions each official works, or let officials pick open games from a private link when you're short.",
    eliteInline: true,
  },
  {
    icon: Store,
    area: "Snack shack",
    title: "Shifts from the schedule",
    description:
      "Shifts are built from game times, assigned to teams, and families sign up for spots.",
  },
  {
    icon: ClipboardList,
    area: "Volunteers",
    title: "Sign-ups without the spreadsheet",
    description:
      "One link for GameChanger, field prep and every other role. Reminders, no-show tracking and family goals included.",
    elite: true,
  },
];

function EliteTag() {
  return (
    <span className="inline-flex flex-shrink-0 items-center rounded-full align-middle bg-[#0C1F3F] px-2 py-0.5 text-[11px] font-semibold text-white">
      Elite
    </span>
  );
}

export function Features() {
  return (
    <section id="features" className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Everything your league runs on, in one place
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            The schedule is the backbone. Officials, snack shack and volunteers hang off it, so
            they move when it moves.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, area, title, description, elite, eliteInline }) => (
            <div
              key={area}
              className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-7"
            >
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#0C1F3F]">
                  <Icon className="h-5 w-5 text-[#22C55E]" />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {area}
                </span>
                {elite && <EliteTag />}
              </div>
              <div>
                <h3 className="font-semibold text-[#0C1F3F]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  {description}
                  {eliteInline && (
                    <>
                      {" "}
                      <EliteTag />
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
