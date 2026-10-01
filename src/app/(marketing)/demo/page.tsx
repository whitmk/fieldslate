import type { Metadata } from "next";
import Link from "next/link";
import { DemoRequestForm } from "@/components/marketing/demo-request-form";

// Public "Request a demo" page. The form posts to /api/demo-request, which
// saves the answers and emails hello@; Whit replies personally with times.
// No calendar booking, no confirmation email to the requester.

export const metadata: Metadata = {
  title: "Request a demo · FieldSlate",
  description:
    "Tell us a little about your league and Whit will reach out with a few times that work for a FieldSlate demo.",
};

export default function DemoPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mb-10 border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Request a demo
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Tell us a little about your league and Whit will reach out with a few times that
            work.
          </p>
          <p className="mt-3 text-xs text-gray-500">
            Prefer email? Write to{" "}
            <a href="mailto:hello@thefieldslate.com" className="font-medium text-[#22C55E] hover:underline">
              hello@thefieldslate.com
            </a>
            . See our{" "}
            <Link href="/privacy" className="font-medium text-[#22C55E] hover:underline">
              Privacy Policy
            </Link>{" "}
            for how we handle what you share.
          </p>
        </div>

        <DemoRequestForm />

        <div className="mt-12 border-t border-gray-100 pt-6 text-center">
          <Link href="/" className="text-sm text-gray-500 transition-colors hover:text-[#0C1F3F]">
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
