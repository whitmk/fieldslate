import fs from "fs";
import path from "path";
import matter from "gray-matter";

// Markdown posts live in content/blog/*.md. Every read happens at build time —
// the blog routes are fully static (generateStaticParams + no dynamic APIs),
// so none of this runs per-request in production.

export type BlogFaqEntry = {
  question: string;
  answer: string; // plain text — no markdown; rendered into FAQPage JSON-LD
};

export type BlogPost = {
  title: string;
  description: string;
  slug: string;
  datePublished: string; // ISO date, e.g. "2026-07-09"
  dateModified: string; // ISO date
  faq?: BlogFaqEntry[]; // optional; when present the post page emits FAQPage JSON-LD
  content: string; // raw markdown body (frontmatter stripped)
};

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

const FRONTMATTER_KEYS = [
  "title",
  "description",
  "slug",
  "datePublished",
  "dateModified",
] as const;

function parsePost(filePath: string): BlogPost {
  const { data, content } = matter(fs.readFileSync(filePath, "utf8"));
  for (const key of FRONTMATTER_KEYS) {
    if (typeof data[key] !== "string" || data[key].length === 0) {
      // Fail the build loudly rather than shipping a post with broken metadata.
      throw new Error(`Blog post ${filePath} is missing frontmatter field "${key}"`);
    }
  }
  let faq: BlogFaqEntry[] | undefined;
  if (data.faq !== undefined) {
    const entries: unknown = data.faq;
    const valid =
      Array.isArray(entries) &&
      entries.length > 0 &&
      entries.every(
        (e) =>
          e &&
          typeof e.question === "string" &&
          e.question.length > 0 &&
          typeof e.answer === "string" &&
          e.answer.length > 0
      );
    if (!valid) {
      throw new Error(
        `Blog post ${filePath} has a malformed "faq" field — expected a non-empty list of { question, answer } strings`
      );
    }
    faq = entries.map((e) => ({ question: e.question, answer: e.answer }));
  }
  return {
    title: data.title,
    description: data.description,
    slug: data.slug,
    datePublished: data.datePublished,
    dateModified: data.dateModified,
    faq,
    content,
  };
}

export function getAllPosts(): BlogPost[] {
  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => parsePost(path.join(BLOG_DIR, file)))
    .sort((a, b) => (a.datePublished < b.datePublished ? 1 : -1));
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getAllPosts().find((post) => post.slug === slug);
}
