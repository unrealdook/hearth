import { CSSProperties, ButtonHTMLAttributes, ReactNode, useState } from "react";
import * as Lucide from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref"> & {
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Lucide;
  iconAfter?: keyof typeof Lucide;
  loading?: boolean;
  children?: ReactNode;
};

const SIZES: Record<Size, CSSProperties> = {
  sm: { padding: "6px 10px", fontSize: 13, borderRadius: "var(--r-md)" },
  md: { padding: "10px 16px", fontSize: 14 },
  lg: { padding: "12px 20px", fontSize: 15 },
};

const VARIANTS: Record<Variant, CSSProperties> = {
  primary:   { background: "var(--brand)", color: "var(--brand-fg)" },
  secondary: { background: "var(--surface-2)", color: "var(--fg-1)", border: "1px solid var(--border-default)" },
  ghost:     { background: "transparent", color: "var(--fg-1)" },
  danger:    { background: "transparent", color: "var(--danger)", border: "1px solid var(--border-default)" },
};

const HOVER_BG: Record<Variant, string> = {
  primary: "var(--brand-hover)",
  secondary: "var(--surface-3)",
  ghost: "var(--surface-2)",
  danger: "var(--danger-soft)",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconAfter,
  loading,
  children,
  style,
  disabled,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const Icon = icon ? (Lucide[icon] as any) : null;
  const IconAfter = iconAfter ? (Lucide[iconAfter] as any) : null;
  const iconSize = size === "sm" ? 14 : 16;
  const isDisabled = disabled || loading;

  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={isDisabled}
      style={{
        fontFamily: "var(--font-sans)",
        border: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontWeight: 500,
        lineHeight: 1,
        borderRadius: "var(--r-lg)",
        transition: "background var(--dur-micro) var(--ease), transform var(--dur-micro) var(--ease), opacity var(--dur-micro)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.55 : 1,
        ...SIZES[size],
        ...VARIANTS[variant],
        ...(hover && !isDisabled ? { background: HOVER_BG[variant] } : {}),
        ...style,
      }}
      {...rest}
    >
      {Icon && <Icon size={iconSize} strokeWidth={1.75} />}
      {children}
      {IconAfter && <IconAfter size={iconSize} strokeWidth={1.75} />}
    </button>
  );
}
