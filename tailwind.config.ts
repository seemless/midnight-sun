/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,tsx,ts}"],
  theme: {
    extend: {
      colors: {
        midnight: {
          50: "#f0f4ff",
          100: "#dbe4ff",
          200: "#bac8ff",
          300: "#91a7ff",
          400: "#748ffc",
          500: "#5c7cfa",
          600: "#4c6ef5",
          700: "#4263eb",
          800: "#3b5bdb",
          900: "#364fc7",
          950: "#1a1a2e",
        },
        aurora: {
          green: "#69db7c",
          teal: "#38d9a9",
          blue: "#74c0fc",
          purple: "#b197fc",
          pink: "#f783ac",
        },
        surface: {
          0: "#0f0f1a",
          1: "#16162a",
          2: "#1e1e38",
          3: "#262647",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
