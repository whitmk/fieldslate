import Link from "next/link";
import { FieldSlateLockup } from "@/components/brand";
import { SITE_URL } from "@/lib/site";

export function ScheduleHeader({ seasonLabel }: { seasonLabel: string }) {
  return (
    <header className="border-b border-gray-100 bg-[#0C1F3F]">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <FieldSlateLockup height={28} variant="dark" className="flex-shrink-0" />
        <div className="ml-1 flex flex-col border-l border-white/10 pl-3">
          <span className="text-xs text-gray-300">
            Interleague schedule with{" "}
            <span className="font-medium text-white">{seasonLabel}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

export function InviteHeader({
  senderName,
  seasonLabel,
}: {
  senderName?: string;
  seasonLabel?: string;
}) {
  return (
    <header className="border-b border-gray-100 bg-[#0C1F3F]">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <FieldSlateLockup height={28} variant="dark" className="flex-shrink-0" />
        <div className="ml-1 flex flex-col border-l border-white/10 pl-3">
          {senderName && seasonLabel ? (
            <span className="text-xs text-gray-300">
              You&apos;ve been invited by{" "}
              <span className="font-medium text-white">{senderName}</span>
              {" · "}
              <span className="text-gray-300">{seasonLabel}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-300">Interleague invite</span>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Three renderings, chosen by props:
 *  - no props: the original "Curious about FieldSlate?" line, byte-identical
 *    to before Case A — still what the schedule and reschedule token pages and
 *    the invite status screens render.
 *  - hostLeagueName: the anonymous PENDING invite page's promo line (Case A,
 *    2026-09-28 — REPLACES the original copy there, never sits beside it).
 *  - plain: the tagline only, for a SIGNED-IN partner, who is already a
 *    FieldSlate customer and should not be pitched a first season.
 */
export function InviteFooter({
  hostLeagueName,
  plain,
}: {
  hostLeagueName?: string | null;
  plain?: boolean;
} = {}) {
  const signupHref = `${SITE_URL}/signup?promo=INTERLEAGUE&utm_source=invite&utm_medium=email`;
  if (plain) {
    return (
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-6 text-center sm:px-6 lg:px-8">
          <p className="text-xs text-gray-500">
            FieldSlate · Scheduling for youth sports leagues.
          </p>
        </div>
      </footer>
    );
  }
  if (hostLeagueName) {
    return (
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-6 text-center sm:px-6 lg:px-8">
          <p className="text-xs text-gray-500">
            {hostLeagueName} builds their schedule on FieldSlate. Field conflicts,
            officials, rainouts, snack shack and dual coach protection in one place,
            plus easy exports to the systems you already use.{" "}
            <Link href={signupHref} className="font-semibold text-[#22C55E] hover:underline">
              See how easy it is today — 20% off your first season
            </Link>
            .
          </p>
        </div>
      </footer>
    );
  }
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto max-w-3xl px-4 py-6 text-center sm:px-6 lg:px-8">
        <p className="text-xs text-gray-500">
          Curious about FieldSlate? It&apos;s a scheduling tool for youth sports
          leagues.{" "}
          <Link
            href={signupHref}
            className="font-semibold text-[#22C55E] hover:underline"
          >
            Try your first season for 20% off
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
