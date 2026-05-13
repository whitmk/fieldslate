import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

const proofPoints = [
  "No credit card required",
  "Baseball & soccer ready",
  "Export to Sports Connect & BYGA",
];

export function Hero() {
  return (
    <section className="bg-[#0C1F3F] pb-24 pt-20 sm:pb-32 sm:pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">

          {/* Pill tag */}
          <div className="mb-6 inline-flex items-center rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-1.5">
            <span className="text-sm font-medium text-[#22C55E]">
              Built for multi-league admins
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
            Schedule your entire season in{" "}
            <span className="text-[#22C55E]">minutes.</span>
          </h1>

          {/* Subheadline */}
          <p className="mt-6 text-lg leading-8 text-white/60">
            Per-division parameters, automatic field conflict detection, and interleague
            scheduling — all in one place. No spreadsheets. No phone calls.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/signup">
              <Button
                size="lg"
                className="bg-[#22C55E] px-8 font-semibold text-white hover:bg-[#16a34a]"
              >
                Start free →
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button
                size="lg"
                variant="ghost"
                className="border border-white/20 px-8 text-white hover:bg-white/10 hover:text-white"
              >
                See how it works
              </Button>
            </Link>
          </div>

          {/* Proof points */}
          <ul className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
            {proofPoints.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
                <span className="text-sm text-white/50">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
