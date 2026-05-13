const AVATAR_COLORS = [
  "#0C1F3F", // navy
  "#22C55E", // green
  "#F59E0B", // amber
  "#7C3AED", // purple
  "#0D9488", // teal
  "#DC2626", // red
];

export function teamAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}
