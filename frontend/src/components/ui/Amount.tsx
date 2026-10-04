import { fmtMoney } from "@/lib/format";
import { usePrivacy } from "@/hooks/usePrivacy";

type Size = "sm" | "md" | "lg" | "xl" | "hero";
type Props = {
  value: number | null | undefined;
  size?: Size;
  muted?: boolean;
  signed?: boolean;
};

const SIZES: Record<Size, number> = { sm: 14, md: 18, lg: 24, xl: 32, hero: 56 };
const SYMBOL_SIZES: Record<Size, number> = { sm: 12, md: 14, lg: 16, xl: 20, hero: 36 };
// Bigger numbers need a heavier blur — large digits remain readable through a uniform blur.
const BLUR_PX: Record<Size, number> = { sm: 8, md: 9, lg: 11, xl: 14, hero: 18 };

export function Amount({ value, size = "md", muted, signed }: Props) {
  const { on: privacyOn } = usePrivacy();
  const v = Number(value ?? 0);
  const negative = v < 0;
  const abs = Math.abs(v);
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: SIZES[size],
        fontWeight: 500,
        letterSpacing: size === "hero" ? "-0.03em" : "-0.02em",
        fontFeatureSettings: '"tnum" 1',
        color: muted ? "var(--fg-3)" : negative ? "var(--danger)" : "var(--fg-1)",
        whiteSpace: "nowrap",
        filter: privacyOn ? `blur(${BLUR_PX[size]}px)` : undefined,
        userSelect: privacyOn ? "none" : undefined,
        transition: "filter var(--dur-state) var(--ease)",
      }}
    >
      {signed && !negative && (
        <span style={{ color: "var(--success)", marginRight: 2 }}>+</span>
      )}
      {negative && <span style={{ marginRight: 2 }}>−</span>}
      <span style={{ color: muted ? "var(--fg-4)" : "var(--fg-3)", marginRight: 4, fontSize: SYMBOL_SIZES[size] }}>$</span>
      {fmtMoney(abs)}
    </span>
  );
}
