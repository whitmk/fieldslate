import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { MarketingNavbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { SITE_URL } from "@/lib/site";

// Matches the hero's click-to-play YouTube embed (video ID yKggoZaAHYo).
const videoJsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: "FieldSlate — Season Scheduling for Youth Sports Leagues",
  description:
    "Four teams, one field, no plan — see how FieldSlate replaces scheduling chaos with conflict-free season schedules for volunteer-run youth sports leagues.",
  thumbnailUrl: `${SITE_URL}/promo-poster.jpg`,
  uploadDate: "2026-07-15",
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
      <MarketingNavbar />
      <main className="flex-1">
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}
