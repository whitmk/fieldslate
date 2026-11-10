import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroVideo } from "@/components/marketing/hero-video";

export function Hero() {
  return (
    <section className="bg-[#0C1F3F] pb-24 pt-20 sm:pb-32 sm:pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">

          {/* Pill tag */}
          <div className="mb-6 inline-flex items-center rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-1.5">
            <span className="text-sm font-medium text-[#22C55E]">
              Retire the scheduling spreadsheet
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
            Schedule the season. Staff every game.{" "}
            <span className="text-[#22C55E]">Fill every volunteer spot.</span>
          </h1>

          {/* Subheadline */}
          <p className="mt-6 text-balance text-lg leading-8 text-white/60">
            Games, practices, officials, snack shack and volunteers, scheduled, staffed and
            tracked in one system that talks to itself. When a game moves, everyone who needs to
            know does.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/signup">
              <Button
                size="lg"
                className="bg-[#22C55E] px-8 font-semibold text-white hover:bg-[#16a34a]"
              >
                Start free
              </Button>
            </Link>
            <Link href="/demo">
              <Button
                size="lg"
                variant="ghost"
                className="border border-white/20 px-8 text-white hover:bg-white/10 hover:text-white"
              >
                Request a demo
              </Button>
            </Link>
          </div>

          {/* Line under the buttons */}
          <p className="mt-8 text-sm text-white/60">
            Built by a Little League board member. Free for a single division. No credit
            card required.
          </p>
        </div>

        {/* Promo video — wider than the text column, below the fold-critical
            CTAs and the line under them so nothing above it moves on mobile. */}
        <HeroVideo />
      </div>
    </section>
  );
}
