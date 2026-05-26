import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Contact · FieldSlate",
  description:
    "Get in touch with FieldSlate. Submit a general inquiry or a privacy / data subject request.",
};

export default function ContactPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mb-10 border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Contact us
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Use this form for general questions, billing issues, feature
            requests, or to exercise your privacy rights (view, correct, or
            delete personal data). We respond within{" "}
            <span className="font-medium text-[#0C1F3F]">2 business days</span>.
          </p>
          <p className="mt-3 text-xs text-gray-500">
            You can also email us directly at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            . See our{" "}
            <Link
              href="/privacy"
              className="font-medium text-[#22C55E] hover:underline"
            >
              Privacy Policy
            </Link>{" "}
            for details on how data requests are handled.
          </p>
        </div>

        <ContactForm />

        <div className="mt-12 border-t border-gray-100 pt-6 text-center">
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
