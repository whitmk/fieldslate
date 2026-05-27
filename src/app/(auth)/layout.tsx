import { FieldSlateLockup } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#0C1F3F]">
      {/* Left panel — brand side, hidden on mobile. Surface = navy → dark lockup. */}
      <div className="hidden w-[480px] flex-shrink-0 flex-col justify-between p-12 lg:flex">
        <a href="/" aria-label="FieldSlate home" className="inline-flex">
          <FieldSlateLockup height={32} variant="dark" />
        </a>

        <div>
          <p className="text-3xl font-bold leading-snug text-white">
            Schedule your entire<br />
            season in{" "}
            <span className="text-[#22C55E]">minutes.</span>
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {[
              "Per-division parameters",
              "Automatic field conflict detection",
              "Cross-season scheduling",
              "No spreadsheets. No phone calls.",
            ].map((point) => (
              <li key={point} className="flex items-center gap-3">
                <svg className="h-4 w-4 flex-shrink-0 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-white/50">{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/20">
          &copy; {new Date().getFullYear()} FieldSlate
        </p>
      </div>

      {/* Right panel — form. Inherits navy fill from parent → dark lockup. */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Mobile-only logo */}
          <a
            href="/"
            aria-label="FieldSlate home"
            className="mb-8 flex justify-center lg:hidden"
          >
            <FieldSlateLockup height={32} variant="dark" />
          </a>
          {children}
        </div>
      </div>
    </div>
  );
}
