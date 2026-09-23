"use client";

// The two slot-picker override toggles and the chips that mark what they
// surface. ONE component, two hosts (the rainout reschedule modal and the
// interleague counter-proposal picker) — same rule as VenueEditForm: the
// wording and the styling live here so the two surfaces cannot drift.
//
// Both toggles are OFF by default, so the normal path is untouched. Each lifts
// exactly one gate; see SlotOverrides in lib/schedule/reschedule-slots.ts for
// what stays enforced (everything else).
//
// THE CHIPS MUST READ ON THEIR OWN. Someone scrolling a long list will not have
// the toggle label in view, so "Off day" and "2nd game" each carry a `title`
// spelling the exception out, and the amber treatment matches this codebase's
// existing "needs a second look" signal. An override slot must never look like
// a normal offer.

import type { SlotException, SlotOverrides } from "@/lib/schedule/reschedule-slots";

export const OVERRIDE_HELP = {
  offDay: "The field's own hours apply on those days.",
  secondGame: "The team still can't play two games at once.",
} as const;

const CHIP: Record<SlotException, { label: string; title: string }> = {
  off_day: {
    label: "Off day",
    title: "Outside the days this division normally plays — the field's own hours applied.",
  },
  second_game: {
    label: "2nd game",
    title: "This team already has a game that day.",
  },
};

/** Renders nothing for a normal slot (no `exceptions` key at all). */
export function SlotExceptionChips({ exceptions }: { exceptions?: SlotException[] }) {
  if (!exceptions?.length) return null;
  return (
    <>
      {exceptions.map((e) => (
        <span
          key={e}
          title={CHIP[e].title}
          className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
        >
          {CHIP[e].label}
        </span>
      ))}
    </>
  );
}

export function SlotOverrideToggles({
  value,
  onChange,
  divisionLabel,
  disabled,
}: {
  value: SlotOverrides;
  onChange: (next: SlotOverrides) => void;
  /** "AA", or "this division" when the name isn't loaded. */
  divisionLabel: string;
  disabled?: boolean;
}) {
  const row = "flex cursor-pointer items-start gap-2.5 py-1.5";
  const box =
    "mt-0.5 h-3.5 w-3.5 flex-shrink-0 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]";

  return (
    <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Show more times
      </p>
      <label className={row}>
        <input
          type="checkbox"
          className={box}
          checked={value.includeNonPlayingDays === true}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, includeNonPlayingDays: e.target.checked })
          }
        />
        <span className="text-xs text-gray-600">
          Include days {divisionLabel} doesn&rsquo;t normally play
          <span className="block text-[11px] text-gray-400">{OVERRIDE_HELP.offDay}</span>
        </span>
      </label>
      <label className={row}>
        <input
          type="checkbox"
          className={box}
          checked={value.allowSecondGameSameDay === true}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, allowSecondGameSameDay: e.target.checked })
          }
        />
        <span className="text-xs text-gray-600">
          Allow a second game the same day
          <span className="block text-[11px] text-gray-400">{OVERRIDE_HELP.secondGame}</span>
        </span>
      </label>
    </div>
  );
}
