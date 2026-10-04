import { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  onClick?: () => void;
};

export function Card({ children, padding = 24, style, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r-lg)",
        padding,
        cursor: onClick ? "pointer" : undefined,
        transition: onClick ? "background var(--dur-micro) var(--ease)" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
