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
  // FAQ pairs live in the post's frontmatter (plain-text answers), so any post
  // with a `faq` field gets a FAQPage block — nothing is gated to one slug.
  const faqJsonLd = post.faq
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: post.faq.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      }
    : null;

  return (
    <div className="bg-fs-paper">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      {faqJsonLd && (
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
