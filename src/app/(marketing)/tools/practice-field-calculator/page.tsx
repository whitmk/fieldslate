import type { Metadata } from "next";
import { PracticeFieldCalculator } from "@/components/marketing/practice-calculator/calculator";
import { SITE_URL } from "@/lib/site";

// Public, free practice field calculator. No sign-in, no database, no API
// route — every number is computed in the browser by src/lib/practice-
// planner/ and nothing entered here is saved or sent anywhere. The approved
// mockup is docs/mockups/practice-field-calculator.html.

const URL_PATH = "/tools/practice-field-calculator";
const TITLE = "Practice field calculator";
const DESCRIPTION =
  "Free tool for league boards: enter each division's teams, practice days and times, and get how many practice fields to request from your city, night by night. Nothing is saved.";

export const metadata: Metadata = {
  title: `${TITLE}: how many fields to request · FieldSlate`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${URL_PATH}` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}${URL_PATH}`,
    siteName: "FieldSlate",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/opengraph-image.png`],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/opengraph-image.png`],
  },
};

// Plain structured data, deliberately WITHOUT ratings or reviews — self-
// published ratings aren't eligible for rich results and would only invite a
// manual action (same call as the homepage testimonial).
const webApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "FieldSlate Practice Field Calculator",
  url: `${SITE_URL}${URL_PATH}`,
  description: DESCRIPTION,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: "FieldSlate", url: SITE_URL },
};

export default function PracticeFieldCalculatorPage() {
  return (
    <div className="bg-fs-paper">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationJsonLd) }}
      />
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <header className="print:hidden">
          <p className="text-sm font-semibold text-[#16a34a]">Free tool</p>
          <h1 className="mt-2 max-w-[18ch] text-3xl font-extrabold tracking-tight text-[#0C1F3F] sm:text-4xl">
            How many practice fields do you need?
          </h1>
          <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-gray-600">
            Enter each division&apos;s teams, practice days and times. You&apos;ll get the number of fields to
            request from your city, night by night, ready to paste into the request.
          </p>
        </header>
        <PracticeFieldCalculator />
      </div>
    </div>
  );
}
