import Link from "next/link";
import { Button } from "@/components/ui/button";

export function MarketingNavbar() {
  return (
    <header className="sticky top-0 z-50 bg-[#0C1F3F]">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#22C55E]">
            <span className="text-sm font-bold text-white">FS</span>
          </div>
          <span className="text-lg font-bold">
            <span className="text-white">Field</span><span className="text-[#22C55E]">Slate</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link href="#features" className="text-sm text-white/70 transition-colors hover:text-white">
            Features
          </Link>
          <Link href="#how-it-works" className="text-sm text-white/70 transition-colors hover:text-white">
            How it works
          </Link>
          <Link href="#pricing" className="text-sm text-white/70 transition-colors hover:text-white">
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm" className="bg-[#22C55E] font-semibold text-white hover:bg-[#16a34a]">
              Start free
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
