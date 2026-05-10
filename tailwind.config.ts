import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(15, 23, 42, 0.06)",
      },
      opacity: {
        2: "0.02",
        3: "0.03",
        8: "0.08",
        15: "0.15",
        18: "0.18",
        24: "0.24",
        35: "0.35",
        55: "0.55",
        65: "0.65",
        72: "0.72",
        74: "0.74",
        76: "0.76",
        78: "0.78",
        82: "0.82",
        84: "0.84",
        85: "0.85",
        86: "0.86",
        90: "0.90",
      },
    },
  },
  plugins: [],
} satisfies Config;
