/**
 * Semantic palette as CSS variables (NativeWind dynamic-themes pattern):
 * classNames like `bg-ink text-paper` stay unchanged across screens, and the
 * root ThemeVars wrapper swaps the variable values per light/dark theme.
 * `:root` carries the dark values so first paint matches before hydration.
 */
const varColor = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: varColor("--sb-ink"),
        panel: varColor("--sb-panel"),
        panel2: varColor("--sb-panel2"),
        line: varColor("--sb-line"),
        paper: varColor("--sb-paper"),
        muted: varColor("--sb-muted"),
        amber: varColor("--sb-amber"), // visual mode signal (deepened on light)
        cyanx: varColor("--sb-cyanx"), // hearing mode signal (deepened on light)
        coral: varColor("--sb-coral"), // hazards only
        mint: varColor("--sb-mint"),
      },
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        ":root": {
          "--sb-ink": "6 13 20",
          "--sb-panel": "13 27 41",
          "--sb-panel2": "18 37 57",
          "--sb-line": "30 52 72",
          "--sb-paper": "244 249 255",
          "--sb-muted": "159 180 199",
          "--sb-amber": "255 178 36",
          "--sb-cyanx": "62 230 255",
          "--sb-coral": "255 84 104",
          "--sb-mint": "61 219 168",
        },
      }),
  ],
};
