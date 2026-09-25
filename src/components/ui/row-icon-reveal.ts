// Hover-reveal for per-row icon buttons, keyed on INPUT TYPE, not screen size.
//
// On a device that can hover (a mouse or trackpad — `@media (hover: hover)`,
// the `can-hover:` variant in tailwind.config.ts) the icon is hidden until the
// row is hovered and sits pale grey-200: exactly the look these icons had
// before 2026-09-25. On a device that CANNOT hover (a phone or tablet) it is
// always visible, at grey-400 so it can actually be seen on white.
//
// WHY: before this, a touch screen never fired the hover, so the rainout
// cloud was INVISIBLE BUT TAPPABLE — a tap on the blank right edge of a row
// could mark a game rained out with no control on screen. The admin who uses
// this most works from a phone.
//
// Pinned by `npm run sim:row-icon-reveal`, which compiles these classes with
// the REAL Tailwind config and checks the effective opacity/colour on both
// device types against the pre-change classes. The string must stay a complete
// literal here — Tailwind's JIT only emits classes it can read in full, and
// this file sits under src/components, which the content globs scan.
export const ROW_ICON_REVEAL =
  "text-gray-400 can-hover:text-gray-200 can-hover:opacity-0 group-hover:opacity-100";
