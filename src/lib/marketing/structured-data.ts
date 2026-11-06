// Homepage structured data (JSON-LD). Pure objects — the page only
// serializes them.
//
// Prices come from the ONE price config (src/lib/billing/prices.ts), the same
// numbers the checkout verifies against Stripe. Never type a price here.
// Free has no entry in that config; its price is an explicit 0. The one-time
// Pro→Elite upgrade is not a plan and is deliberately not an offer.

import { PRICE_CURRENCY, SEASON_PRICE_USD } from "@/lib/billing/prices";
import { SITE_URL } from "@/lib/site";
import { HOME_FAQ } from "@/lib/marketing/home-faq";

const CURRENCY = PRICE_CURRENCY.toUpperCase();

function seasonOffer(name: string, price: number, description: string) {
  return {
    "@type": "Offer",
    name,
    price: String(price),
    priceCurrency: CURRENCY,
    description,
    url: `${SITE_URL}/#pricing`,
  };
}

export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "FieldSlate",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: `${SITE_URL}/`,
  offers: [
    seasonOffer("Free", 0, "Free tier: one active season at a time."),
    seasonOffer("Pro", SEASON_PRICE_USD.pro, "Priced per season."),
    seasonOffer("Elite", SEASON_PRICE_USD.elite, "Priced per season."),
  ],
};

// sameAs lists only profiles FieldSlate runs itself.
export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "FieldSlate",
  alternateName: "Field Slate",
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/brand/lockup-email-2x.png`,
  sameAs: ["https://www.instagram.com/thefieldslate/"],
};

// The homepage FAQ, built from the SAME list the visible section renders
// (HOME_FAQ), so the two cannot drift. Answers are plain text.
// `npm run sim:home-faq` checks this against the list.
export const homeFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: HOME_FAQ.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};
