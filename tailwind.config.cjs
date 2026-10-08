const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,svelte,ts,tsx,vue}"],
  theme: {
    // Preserve the former fluid-type 2.0.7 scale, including its line heights.
    fontSize: Object.fromEntries(
      ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"].map((name, index) => {
        const step = index - 2;
        const a = 1.125 * Math.pow(1.125, step);
        const b = 1.25 * Math.pow(1.2, step);
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        const lineHeight = index < 4 ? "1.6" : index < 7 ? "1.2" : index < 10 ? "1.1" : "1";
        return [name, [`clamp(${min}rem, calc(${min}rem + ((${max} - ${min}) * ((100vw - 20rem) / (96 - 20)))), ${max}rem)`, { lineHeight }]];
      }),
    ),
    extend: {
      fontFamily: {
        sans: ["Inter Variable", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
      },
      textColor: {
        default: "var(--color-text)",
        offset: "var(--color-text-offset)",
      },
      backgroundColor: {
        default: "var(--color-background)",
        offset: "var(--color-background-offset)",
      },
      borderColor: {
        default: "var(--color-border)",
      },
    },
  },
};
