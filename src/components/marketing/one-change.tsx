// Homepage "One change. Everyone knows." — why one connected system beats
// several good tools. Sits directly under the Testimonial (gray-50), so it is
// white; Features below it is gray-50.
//
// Every card states what the product ACTUALLY does when a game moves
// (positioning doc 2026-11-10, "Claims to keep honest"):
//   - Families: team calendar feeds update on the phone's own schedule —
//     never "instantly".
//   - Officials: assignments ride the game (game_umpires keys on the game
//     id) and nobody is ever unassigned by a change. Since 0130 each
//     assigned official gets one email per window (moved / rained out /
//     makeup / back on / taken off), and a move that puts an official in
//     two places goes to the league's officials contact. Gated: Elite, a
//     confirmed officials contact, the notices setting on (default on) —
//     like the Volunteers card, the card states the Elite behaviour.
//   - Volunteers: 0121's game_moved email (keep the spot or cancel).
//   - Snack shack: shifts are derived from the games, but a change reaches
//     the shifts only when the admin regenerates them; the page flags the
//     days that no longer match.
//
// Server component. Colors are the homepage's hex literals, not fs-* tokens.

import { CalendarDays, ClipboardList, ShieldCheck, Store } from "lucide-react";

const CARDS = [
  {
    icon: CalendarDays,
    title: "Families",
    text: "The game moves on every team's calendar feed, so parents' phones update on their own.",
  },
  {
    icon: ShieldCheck,
    title: "Officials",
    text: "Assigned umpires stay on the game and get an email with the new time. If a move puts one in two places, you're told.",
  },
  {
    icon: ClipboardList,
    title: "Volunteers",
    text: "The GameChanger and field-prep spots move with the game, and each volunteer gets an email to keep the spot or cancel.",
  },
  {
    icon: Store,
    title: "Snack shack",
    text: "Shifts are built from the game schedule, and FieldSlate shows you which days to rebuild when the games change.",
  },
];

export function OneChange() {
  return (
    <section id="one-change" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            One change. Everyone knows.
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Saturday&apos;s 9:00 game moves to 11:00. In most leagues that&apos;s a dozen texts and
            a hope that nobody missed one. In FieldSlate, it&apos;s one edit.
          </p>
        </div>

        <p className="mx-auto mt-12 max-w-5xl text-sm font-semibold uppercase tracking-wide text-gray-400">
          What happens when you move it
        </p>
        <div className="mx-auto mt-4 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-6"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#0C1F3F]">
                <Icon className="h-5 w-5 text-[#22C55E]" />
              </div>
              <div>
                <h3 className="font-semibold text-[#0C1F3F]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{text}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-base font-medium text-[#0C1F3F]">
          Rained out? Volunteers keep their spots and hear from us when the makeup date is set.
        </p>
      </div>
    </section>
  );
}
