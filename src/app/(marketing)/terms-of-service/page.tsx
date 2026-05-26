import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service · FieldSlate",
  description:
    "The legal terms that govern your access to and use of FieldSlate.",
};

const LAST_UPDATED = "May 26, 2026";

export default function TermsOfServicePage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        {/* Header */}
        <div className="border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Last updated {LAST_UPDATED}
          </p>
        </div>

        {/* Body */}
        <section className="mt-10 space-y-4 text-sm leading-relaxed text-gray-700">
          {/* PASTE TERMS OF SERVICE TEXT HERE */}
        </section>

        {/* Back to top */}
        <div className="mt-16 border-t border-gray-100 pt-8 text-center">
          <Link
            href="/"
            className="text-sm text-gray-500 transition-colors hover:text-[#0C1F3F]"
          >
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
