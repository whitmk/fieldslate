import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

// Public marketing routes only — auth and dashboard routes deliberately excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/` },
    { url: `${SITE_URL}/contact` },
    { url: `${SITE_URL}/privacy` },
    { url: `${SITE_URL}/terms-of-service` },
    { url: `${SITE_URL}/blog` },
  ];
  const postRoutes: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.dateModified,
  }));
  return [...staticRoutes, ...postRoutes];
}
