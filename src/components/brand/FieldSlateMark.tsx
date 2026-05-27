/**
 * FieldSlate brand mark — "Schedule grid → F" (option 05).
 * Inline SVG for stylability + tree-shaking. 64×64 viewBox; scales freely.
 *
 * Variants:
 *   "dark"  — navy bg, white + green cells (use on light surfaces)
 *   "light" — paper bg, navy + green-dk cells (use on dark surfaces)
 *   "mono"  — single-color, fill controlled by CSS `color` (currentColor)
 *
 * Minimum size: 24px. Below that, prefer /favicon.svg (no faint grid).
 */
export type FieldSlateMarkVariant = "dark" | "light" | "mono";

export function FieldSlateMark({
  size = 40,
  variant = "dark",
  className,
}: {
  size?: number;
  variant?: FieldSlateMarkVariant;
  className?: string;
}) {
  const isDark = variant === "dark";
  const isMono = variant === "mono";

  const bg = isMono ? "currentColor" : isDark ? "#0b1c39" : "#f4f5f0";
  const ink = isMono ? "#ffffff" : isDark ? "#ffffff" : "#0b1c39";
  const accent = isMono ? "#ffffff" : isDark ? "#22c55e" : "#16a34a";
  const faint = isMono ? 0.12 : isDark ? 0.1 : 0.08;
  const faintColor = isMono ? "#ffffff" : isDark ? "#ffffff" : "#0b1c39";

  // F-shape cells. (col, row, kind). Accent at (0,0) and (1,2).
  const cells: Array<[number, number, "ink" | "accent"]> = [
    [0, 0, "accent"], [1, 0, "ink"], [2, 0, "ink"], [3, 0, "ink"],
    [0, 1, "ink"],
    [0, 2, "ink"], [1, 2, "accent"], [2, 2, "ink"],
    [0, 3, "ink"],
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="FieldSlate"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill={bg} />
      <g fill={faintColor} opacity={faint}>
        {Array.from({ length: 4 }, (_, r) =>
          Array.from({ length: 4 }, (_, c) => (
            <rect
              key={`${r}-${c}`}
              x={10 + c * 12}
              y={10 + r * 12}
              width="11"
              height="11"
              rx="2"
            />
          ))
        )}
      </g>
      {cells.map(([c, r, kind], i) => (
        <rect
          key={i}
          x={10 + c * 12}
          y={10 + r * 12}
          width="11"
          height="11"
          rx="2"
          fill={kind === "accent" ? accent : ink}
        />
      ))}
    </svg>
  );
}
