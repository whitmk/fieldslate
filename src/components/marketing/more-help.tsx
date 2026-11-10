// "More help" — the line at the foot of every /help page, linking the others.
// The current page is named but not linked. A new help page goes in HELP_PAGES
// and in src/app/sitemap.ts.
import Link from "next/link";

export const HELP_PAGES = [
  { href: "/help/calendar", label: "Calendar subscriptions" },
  { href: "/help/volunteers", label: "Volunteer sign-ups" },
  { href: "/help/officials-signup", label: "Officials sign-up" },
] as const;

export function MoreHelp({ current }: { current: (typeof HELP_PAGES)[number]["href"] }) {
  return (
    <p className="mt-12 text-center text-sm text-gray-500">
      More help:{" "}
      {HELP_PAGES.map(({ href, label }, i) => (
        <span key={href}>
          {i > 0 && " · "}
          {href === current ? (
            <span className="whitespace-nowrap text-gray-700">{label}</span>
          ) : (
            <Link href={href} className="whitespace-nowrap font-medium text-[#22C55E] hover:underline">
              {label}
            </Link>
          )}
        </span>
      ))}
    </p>
  );
}
