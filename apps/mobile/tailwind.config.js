/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#060D14",
        panel: "#0D1B29",
        panel2: "#122539",
        line: "#1E3448",
        paper: "#F4F9FF",
        muted: "#9FB4C7",
        amber: "#FFB224", // visual mode signal
        cyanx: "#3EE6FF", // hearing mode signal
        coral: "#FF5468", // hazards only
        mint: "#3DDBA8",
      },
    },
  },
  plugins: [],
};
