import { CSSProperties } from "react";

type Option = { label: string; value: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
};

/** Segmented control — a compact pill switcher for in-page sub-navigation. */
export function Segmented({ options, value, onChange, style }: Props) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        background: "var(--surface-inset)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r-lg)",
        ...style,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "inherit",
              border: "none",
              borderRadius: "var(--r-md)",
              cursor: "pointer",
              color: active ? "var(--fg-1)" : "var(--fg-3)",
              background: active ? "var(--surface-2)" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.25)" : "none",
              transition: "background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
