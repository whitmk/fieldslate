import Link from "next/link";
import { ArrowRight } from "lucide-react";

// The empty-state pointer back into the first-run wizard. Rendered only when
// the page's server component verified BOTH gates: viewer is acting in their
// OWN org, and deriveSetupStep() says setup is incomplete. A quiet second
// line — pages drop it under their existing empty-state copy via className.
export function FinishSetupLink({ className }: { className?: string }) {
  return (
    <Link
      href="/setup"
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-[#22C55E] underline-offset-2 hover:underline ${className ?? ""}`}
    >
      Finish setting up your league
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}
