import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-[#0C1F3F]">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-between">

          {/* Brand */}
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#22C55E]">
                <span className="text-xs font-bold text-white">FS</span>
              </div>
              <span className="font-bold text-lg">
                <span className="text-white">Field</span><span className="text-[#22C55E]">Slate</span>
              </span>
            </div>
            <p className="text-sm font-medium text-white/40">
              No player data. No coach data. Ever.
            </p>
          </div>

          {/* Nav */}
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
            <Link href="/#features" className="text-sm text-white/40 transition-colors hover:text-white">Features</Link>
            <Link href="/#how-it-works" className="text-sm text-white/40 transition-colors hover:text-white">How it works</Link>
            <Link href="/#pricing" className="text-sm text-white/40 transition-colors hover:text-white">Pricing</Link>
            <Link href="/contact" className="text-sm text-white/40 transition-colors hover:text-white">Contact</Link>
            <Link href="/privacy" className="text-sm text-white/40 transition-colors hover:text-white">Privacy</Link>
            <Link href="/login" className="text-sm text-white/40 transition-colors hover:text-white">Sign in</Link>
          </nav>
        </div>

        <div className="mt-10 border-t border-white/10 pt-8">
          <p className="text-center text-xs text-white/25">
            &copy; {new Date().getFullYear()} FieldSlate. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
