import { X, CloudRain, CalendarClock } from "lucide-react";

/**
 * Which door the reschedule picker was opened from.
 * - "rainout" (the default, and every caller before 2026-09-25): a rained-out
 *   game being put back on the schedule. Rain-cloud header.
 * - "move": the division panel's "Reschedule a game" — a game that was NOT
 *   rained out, moved by choice. A rain cloud there would say something false.
 *
 * The variant changes the header ONLY. The picker, its reads, its gates and its
 * save are identical for both — there is one slot-selection mechanism.
 */
export type RescheduleModalVariant = "rainout" | "move";

/**
 * Lifted verbatim out of RainoutRescheduleModal so its markup can be pinned:
 * `npm run sim:panel-reschedule` asserts the DEFAULT render is byte-identical
 * to scripts/sim/fixtures/reschedule-modal-header-golden.html, recorded before
 * the variant existed. If that fails, an existing caller's header changed.
 */
export function RescheduleModalHeader({
  homeTeamName,
  awayTeamName,
  onClose,
  variant = "rainout",
}: {
  homeTeamName: string;
  awayTeamName: string;
  onClose: () => void;
  variant?: RescheduleModalVariant;
}) {
  return (
        <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              {variant === "move"
                ? <CalendarClock className="h-4 w-4 text-[#22C55E]" />
                : <CloudRain className="h-4 w-4 text-blue-400" />}
              <h2 className="font-semibold text-[#0C1F3F]">Reschedule game</h2>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              {homeTeamName} vs {awayTeamName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
  );
}
