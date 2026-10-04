/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Hearth tokens — referenced via CSS variables so dark/light is centralized
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          inset: "var(--surface-inset)",
        },
        fg: {
          1: "var(--fg-1)",
          2: "var(--fg-2)",
          3: "var(--fg-3)",
          4: "var(--fg-4)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          hover: "var(--brand-hover)",
          press: "var(--brand-press)",
          fg: "var(--brand-fg)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
      },
      borderColor: {
        subtle: "var(--border-subtle)",
        DEFAULT: "var(--border-default)",
        strong: "var(--border-strong)",
      },
      fontFamily: {
        sans: ["Inter Tight", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "20px",
        "2xl": "28px",
      },
    },
  },
  plugins: [],
};
