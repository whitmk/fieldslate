import { Hero } from "@/components/marketing/hero";
import { Testimonial } from "@/components/marketing/testimonial";
import { OneChange } from "@/components/marketing/one-change";
import { ReplaceTools } from "@/components/marketing/replace-tools";
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
  homeFaqJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/marketing/structured-data";

// The homepage's own title and description. They live HERE, not in the root
// layout: the layout's are inherited by every page that sets none (login,
// signup, the dashboard), so a search-facing title there would rename them
// all. The layout's title is a plain string, not a template, so this one
// renders as written. Google cuts a description at roughly 155–160
// characters; the approved one (2026-11-10 positioning) is longer, so its
// last sentence may be clipped in results.
// The canonical is absolute and on www: without one, Google Search Console
// reported the homepage as "Duplicate without user-selected canonical" and
// left it out of the index.
const HOME_DESCRIPTION =
  "Schedule games and practices, staff officials and snack shack, and run volunteer sign-ups in one connected system. When a game moves, everyone who needs to know does.";

// openGraph replaces the layout's (it has none). The og:image still comes from
// the app/opengraph-image file convention.
export const metadata: Metadata = {
  title: "FieldSlate | Youth Sports League Scheduling and Operations Software",
  description: HOME_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    title: "Run your whole league from one place",
    description: HOME_DESCRIPTION,
    url: `${SITE_URL}/`,
    siteName: "FieldSlate",
    type: "website",
  },
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeFaqJsonLd) }}
      />
      <MarketingNavbar />
      <main className="flex-1">
        <Hero />
        <Testimonial />
        <OneChange />
        <Features />
        <HowItWorks />
        <Compare />
        <ReplaceTools />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
