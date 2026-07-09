import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

// All slugs are known at build time; anything else is a 404, not a runtime render.
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPostBySlug(params.slug);
  if (!post) return {};
  // Absolute www URLs built from SITE_URL — deliberately independent of
  // metadataBase (which the root layout does not set).
  const url = `${SITE_URL}/blog/${post.slug}`;
  const ogImage = `${SITE_URL}/opengraph-image.png`;
  return {
    title: `${post.title} · FieldSlate`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: "FieldSlate",
      title: post.title,
      description: post.description,
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

const MANROPE_STACK =
  "var(--font-manrope), Manrope, system-ui, -apple-system, 'Segoe UI', sans-serif";

// Every element type the article uses gets an explicit styled component:
// h1, h2, h3, p, strong, em, a, ul, ol, li, hr. Nothing falls through unstyled.
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1
      className="text-3xl font-extrabold leading-tight tracking-tight text-fs-navy sm:text-4xl"
      style={{ fontFamily: MANROPE_STACK }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      className="mt-12 text-2xl font-extrabold tracking-tight text-fs-navy"
      style={{ fontFamily: MANROPE_STACK }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      className="mt-8 text-xl font-extrabold tracking-tight text-fs-navy"
      style={{ fontFamily: MANROPE_STACK }}
    >
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="mt-5 leading-relaxed text-gray-700">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-fs-navy">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => {
    const isInternal = href?.startsWith("/") || href?.startsWith(SITE_URL);
    return (
      <a
        href={href}
        className="font-medium text-fs-green-dk underline decoration-fs-green-dk/40 underline-offset-2 transition-colors hover:text-fs-navy hover:decoration-fs-navy/40"
        {...(isInternal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => (
    <ul className="mt-5 list-disc space-y-2 pl-6 text-gray-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-5 list-decimal space-y-2 pl-6 text-gray-700">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-10 border-fs-navy/15" />,
};

// The FAQ Q/A pairs are hardcoded from the article's FAQ section (rather than
// parsed out of the markdown), so this JSON-LD block is gated to that one slug.
const FAQ_SLUG = "sports-connect-alternatives-little-league";
const FAQ_ENTRIES = [
  {
    question: "Is Sports Connect really shutting down?",
    answer:
      "Yes. Following the 2025 Stack Sports–PlayMetrics merger, the company announced Sports Connect and the Association Platform will be sunset in 2027.",
  },
  {
    question: "Do Little Leagues get to choose their registration platform?",
    answer:
      "Effectively no — Little League Central Registration moves to PlayMetrics beginning with the 2027 season. Confirm details with your District Administrator.",
  },
  {
    question: "Does the PlayMetrics transition handle my game and field scheduling?",
    answer:
      "That's the question to ask in a demo. Registration and volunteer management are the announced scope; whether its scheduling fits a shared-field, interleague, volunteer-umpire baseball league is something to verify against your own season, not assume.",
  },
  {
    question: "What should we do first?",
    answer:
      'Export your data from Sports Connect, and put "scheduling plan for 2027" on your next board agenda as its own line item — separate from the registration migration.',
  },
];

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  const url = `${SITE_URL}/blog/${post.slug}`;
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    author: { "@type": "Organization", name: "FieldSlate", url: SITE_URL },
    mainEntityOfPage: url,
    url,
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ENTRIES.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <div className="bg-fs-paper">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      {post.slug === FAQ_SLUG && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <ReactMarkdown components={markdownComponents}>{post.content}</ReactMarkdown>
      </article>
    </div>
  );
}
