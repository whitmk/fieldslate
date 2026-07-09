import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Blog · FieldSlate",
  description:
    "Guides and updates for youth-league admins — scheduling, field conflicts, and running a volunteer league.",
  alternates: { canonical: `${SITE_URL}/blog` },
};

const MANROPE_STACK =
  "var(--font-manrope), Manrope, system-ui, -apple-system, 'Segoe UI', sans-serif";

// Deterministic date formatting from the ISO string's own parts — avoids the
// UTC-midnight-vs-build-timezone off-by-one that new Date("YYYY-MM-DD") invites.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export default function BlogIndexPage() {
  const posts = getAllPosts();
  return (
    <div className="bg-fs-paper">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1
          className="text-3xl font-extrabold tracking-tight text-fs-navy sm:text-4xl"
          style={{ fontFamily: MANROPE_STACK }}
        >
          Blog
        </h1>
        <ul className="mt-10 space-y-10">
          {posts.map((post) => (
            <li key={post.slug}>
              <article>
                <p className="text-sm text-gray-500">
                  <time dateTime={post.datePublished}>{formatDate(post.datePublished)}</time>
                </p>
                <h2
                  className="mt-1.5 text-xl font-extrabold tracking-tight text-fs-navy"
                  style={{ fontFamily: MANROPE_STACK }}
                >
                  <Link
                    href={`/blog/${post.slug}`}
                    className="transition-colors hover:text-fs-green-dk"
                  >
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2 leading-relaxed text-gray-700">{post.description}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
