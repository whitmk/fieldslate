import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0C1F3F",
          50:  "#e8ecf3",
          100: "#c5cfe0",
          200: "#9eafcc",
          300: "#768eb8",
          400: "#5774a9",
          500: "#3d5d9a",
          600: "#2e4d88",
          700: "#1f3b72",
          800: "#122c5a",
          900: "#0C1F3F",
        },
        brand: {
          green: "#22C55E",
        },
        // FieldSlate brand palette tokens. Mirrored in :root in globals.css so
        // SVGs and inline styles (e.g. FieldSlateLockup) can reach them.
        "fs-navy":     "#0b1c39",
        "fs-paper":    "#f4f5f0",
        "fs-green":    "#22c55e",   // accent on dark surfaces (= green-500)
        "fs-green-dk": "#16a34a",   // accent on light surfaces (= green-600)
      },
    },
  },
  plugins: [],
};
export default config;
