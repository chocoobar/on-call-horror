import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b0c10",
        panel: "#15171c",
        panel2: "#1b1e25",
        border: "#2a2d35",
        dim: "#9aa0a6",
        accent: "#ff4d4d",
        accentDim: "#7a1f1f",
        easy: "#4caf7d",
        medium: "#e0a83e",
        hard: "#ff4d4d",
      },
      fontFamily: {
        mono: ["Cascadia Code", "SFMono-Regular", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
