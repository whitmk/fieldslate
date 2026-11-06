import { Hero } from "@/components/marketing/hero";
import { Testimonial } from "@/components/marketing/testimonial";
import { Features } from "@/components/marketing/features";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Compare } from "@/components/marketing/compare";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { MarketingNavbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import {
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/marketing/structured-data";

// The homepage's own title and description. They live HERE, not in the root
// layout: the layout's are inherited by every page that sets none (login,
// signup, the dashboard), so a search-facing title there would rename them
// all. The layout's title is a plain string, not a template, so this one
// renders as written. Keep the description to 160 characters or less.
// The canonical is absolute and on www: without one, Google Search Console
// reported the homepage as "Duplicate without user-selected canonical" and
// left it out of the index.
export const metadata: Metadata = {
  title: "FieldSlate | Little League & Youth Sports Scheduling Software",
  description:
    "FieldSlate is scheduling software for Little League and youth sports leagues: field-conflict checks, rainout makeups and playoffs. Start on the free tier.",
  alternates: { canonical: `${SITE_URL}/` },
};

// Matches the hero's click-to-play YouTube embed (video ID yKggoZaAHYo).
const videoJsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: "FieldSlate — Season Scheduling for Youth Sports Leagues",
  description:
    "Four teams, one field, no plan — see how FieldSlate replaces scheduling chaos with conflict-free season schedules for volunteer-run youth sports leagues.",
  thumbnailUrl: `${SITE_URL}/promo-poster.jpg`,
  // A full date-time with a zone: Google rejects a date-only uploadDate
  // ("Invalid datetime value", "missing a timezone").
  uploadDate: "2026-07-15T00:00:00-07:00",
  duration: "PT1M17S",
  embedUrl: "https://www.youtube-nocookie.com/embed/yKggoZaAHYo",
  contentUrl: "https://www.youtube.com/watch?v=yKggoZaAHYo",
};

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <MarketingNavbar />
      <main className="flex-1">
        <Hero />
        <Testimonial />
        <Features />
        <HowItWorks />
        <Compare />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
