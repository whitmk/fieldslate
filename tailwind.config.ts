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
      },
    },
  },
  plugins: [],
};
export default config;
