import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// /robots.txt. Blocks only what no crawler should fetch: API routes and the
// signed-in dashboard. Deliberately does NOT block /login or /signup — those
// carry a page-level noindex, and a crawler that can't fetch a page never sees
// its noindex (a blocked URL can still be indexed from links alone).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
