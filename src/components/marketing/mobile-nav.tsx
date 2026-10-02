"use client";

// Marketing header: the below-md menu. The desktop nav in navbar.tsx is a
// server component and is byte-for-byte what it was; this renders only the
// menu button and the drop-down panel, both `md:hidden`.
//
// Behaviour: a real <button> with aria-expanded/aria-controls; the panel
// takes focus on open and hands it back to the button on close; tapping a
// link, pressing Escape, or tapping outside the header closes it. The panel
// hangs under the sticky 64px header (absolute, inset-x-0) so it never widens
// the page, and it is capped to the viewport so it scrolls rather than
// overflows on a short screen. Colors are the homepage's hex literals.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

const PANEL_ID = "marketing-mobile-nav";

// Same order and anchors as the desktop nav, plus the pages the desktop
// header reaches through its buttons.
const LINKS: { href: string; label: string }[] = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#compare", label: "Compare" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/demo", label: "Request a demo" },
  { href: "/login", label: "Sign in" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  // Set when the panel closes so the effect below knows to return focus
  // (not on first mount, when nothing was ever open).
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      firstLinkRef.current?.focus();
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const header = buttonRef.current?.closest("header");
      if (header && e.target instanceof Node && !header.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] md:hidden"
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
      </button>

      <div
        id={PANEL_ID}
        hidden={!open}
        className="absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto border-y border-white/10 bg-[#0C1F3F] shadow-lg md:hidden"
      >
        <nav aria-label="Site" className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
          <ul>
            {LINKS.map(({ href, label }, i) => (
              <li key={href}>
                <Link
                  ref={i === 0 ? firstLinkRef : undefined}
                  href={href}
                  onClick={close}
                  className="flex min-h-11 items-center rounded-lg px-3 text-base text-white/80 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li className="pb-2 pt-2">
              <Link
                href="/signup"
                onClick={close}
                className="flex min-h-11 items-center justify-center rounded-lg bg-[#22C55E] px-3 text-base font-semibold text-white hover:bg-[#16a34a] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Start free
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}
