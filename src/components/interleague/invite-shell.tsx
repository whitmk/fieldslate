import Link from "next/link";

export function ScheduleHeader({ seasonLabel }: { seasonLabel: string }) {
  return (
    <header className="border-b border-gray-100 bg-[#0C1F3F]">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#22C55E]">
          <span className="text-sm font-bold text-white">FS</span>
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold leading-tight">
            <span className="text-white">Field</span>
            <span className="text-[#22C55E]">Slate</span>
          </span>
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
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#22C55E]">
          <span className="text-sm font-bold text-white">FS</span>
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold leading-tight">
            <span className="text-white">Field</span>
            <span className="text-[#22C55E]">Slate</span>
          </span>
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

export function InviteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto max-w-3xl px-4 py-6 text-center sm:px-6 lg:px-8">
        <p className="text-xs text-gray-500">
          Curious about FieldSlate? It&apos;s a scheduling tool for youth sports
          leagues.{" "}
          <Link
            href="https://thefieldslate.com/?utm_source=invite&utm_medium=email&promo=INTERLEAGUE"
            className="font-semibold text-[#22C55E] hover:underline"
          >
            Try it free
          </Link>{" "}
          — use code{" "}
          <span className="font-mono text-[#0C1F3F]">INTERLEAGUE</span> for 20%
          off your first season.
        </p>
      </div>
    </footer>
  );
}
