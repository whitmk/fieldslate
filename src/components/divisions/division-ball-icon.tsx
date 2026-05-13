// Sport-specific ball icons for division lists.
// Six colors cycle in order: navy → green → amber → purple → teal → red.

const PALETTE = [
  { bg: "bg-[#0C1F3F]/[0.07]", color: "#0C1F3F" }, // navy
  { bg: "bg-[#22C55E]/10",     color: "#16a34a" }, // green
  { bg: "bg-amber-50",          color: "#d97706" }, // amber
  { bg: "bg-purple-50",         color: "#7c3aed" }, // purple
  { bg: "bg-teal-50",           color: "#0d9488" }, // teal
  { bg: "bg-red-50",            color: "#dc2626" }, // red
] as const;

const GRAY = { bg: "bg-gray-50", color: "#9ca3af" };

// Baseball: solid colored circle + white curved seam arcs (stitching on top)
function Baseball({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-full w-full">
      <circle cx="10" cy="10" r="8.5" fill={color} />
      {/* Left seam arc — bows toward the left edge */}
      <path
        d="M7 1.8 C3.5 7 3.5 13 7 18.2"
        stroke="white"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      {/* Right seam arc — bows toward the right edge */}
      <path
        d="M13 1.8 C16.5 7 16.5 13 13 18.2"
        stroke="white"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      {/* Stitch tick marks on left arc */}
      <path d="M5.7 6.5 L7.5 7.3"  stroke="white" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M5.0 9.8 L7.0 10.0" stroke="white" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M5.7 13.2 L7.5 12.5" stroke="white" strokeWidth="0.9" strokeLinecap="round" />
      {/* Stitch tick marks on right arc */}
      <path d="M14.3 6.5 L12.5 7.3"  stroke="white" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M15.0 9.8 L13.0 10.0" stroke="white" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M14.3 13.2 L12.5 12.5" stroke="white" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

// Soccer: solid colored circle + white panel lines (pentagon + radiating edges)
function Soccer({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-full w-full">
      <circle cx="10" cy="10" r="8.5" fill={color} />
      {/* Central pentagon outline */}
      <polygon
        points="10,6.3 13.4,8.7 12.1,12.7 7.9,12.7 6.6,8.7"
        fill="none"
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Lines from each pentagon vertex to the circle edge */}
      <line x1="10"   y1="6.3"  x2="10"   y2="1.5"  stroke="white" strokeWidth="1" strokeLinecap="round" />
      <line x1="13.4" y1="8.7"  x2="17.4" y2="7.2"  stroke="white" strokeWidth="1" strokeLinecap="round" />
      <line x1="12.1" y1="12.7" x2="15.5" y2="16.2" stroke="white" strokeWidth="1" strokeLinecap="round" />
      <line x1="7.9"  y1="12.7" x2="4.5"  y2="16.2" stroke="white" strokeWidth="1" strokeLinecap="round" />
      <line x1="6.6"  y1="8.7"  x2="2.6"  y2="7.2"  stroke="white" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

interface Props {
  sport: string;
  /** 0-based division index — used to pick the cycling color */
  index: number;
  /** Tailwind classes for the outer container (default: h-9 w-9 rounded-lg) */
  containerClassName?: string;
  /** Tailwind classes for the icon wrapper inside (default: h-4 w-4) */
  iconClassName?: string;
  /** Render in neutral gray instead of a cycle color (for empty-state placeholders) */
  muted?: boolean;
}

export function DivisionBallIcon({
  sport,
  index,
  containerClassName = "h-9 w-9 rounded-lg",
  iconClassName = "h-4 w-4",
  muted = false,
}: Props) {
  const palette = muted ? GRAY : PALETTE[index % PALETTE.length];
  const Ball = sport === "Soccer" ? Soccer : Baseball;

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center ${palette.bg} ${containerClassName}`}
    >
      <div className={iconClassName}>
        <Ball color={palette.color} />
      </div>
    </div>
  );
}
