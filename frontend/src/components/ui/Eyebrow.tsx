import { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--fg-2)",
      }}
    >
      {children}
    </div>
  );
}
