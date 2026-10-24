/** @type {import('tailwindcss').Config} */
// Colours, type sizes, radii and the content width come from assets/tokens.css.
module.exports = {
  darkMode: ["class"],
  content: [
    "./components/**/*.{js,vue,ts}",
    "./layouts/**/*.vue",
    "./pages/**/*.vue",
    "./plugins/**/*.{js,ts}",
    "./app.vue",
  ],
  theme: {
    container: {
      center: true,
      padding: "var(--space-5)",
    },
    extend: {
      colors: {
        border: "var(--color-line)",
        input: "var(--color-line-strong)",
        ring: "var(--color-accent)",
        background: "var(--color-surface)",
        foreground: "var(--color-ink)",
        primary: { DEFAULT: "var(--color-accent)", foreground: "var(--color-accent-ink)" },
        secondary: { DEFAULT: "var(--color-surface-sunken)", foreground: "var(--color-ink)" },
        destructive: { DEFAULT: "var(--color-danger)", foreground: "var(--color-accent-ink)" },
        muted: { DEFAULT: "var(--color-surface-sunken)", foreground: "var(--color-ink-muted)" },
        accent: { DEFAULT: "var(--color-accent)", foreground: "var(--color-accent-ink)" },
        popover: { DEFAULT: "var(--color-surface-raised)", foreground: "var(--color-ink)" },
        card: { DEFAULT: "var(--color-surface-raised)", foreground: "var(--color-ink)" },
        ok: "var(--color-ok)",
        warn: "var(--color-warn)",
        danger: "var(--color-danger)",
        sim: "var(--color-sim)",
        xrpl: "var(--color-accent)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        xs: "var(--text-xs)",
        sm: "var(--text-sm)",
        base: "var(--text-base)",
        lg: "var(--text-lg)",
        xl: "var(--text-xl)",
        "2xl": "var(--text-2xl)",
        "3xl": "var(--text-3xl)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      maxWidth: {
        content: "var(--content-width)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
      },
    },
  },
  plugins: [],
};
