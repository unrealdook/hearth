import { ReactNode } from "react";

type Tone = "paid" | "due" | "overdue" | "sched" | "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  paid:    { bg: "var(--success-soft)", fg: "var(--success)" },
  success: { bg: "var(--success-soft)", fg: "var(--success)" },
  due:     { bg: "var(--warning-soft)", fg: "var(--warning)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  overdue: { bg: "var(--danger-soft)",  fg: "var(--danger)"  },
  danger:  { bg: "var(--danger-soft)",  fg: "var(--danger)"  },
  sched:   { bg: "var(--info-soft)",    fg: "var(--info)"    },
  info:    { bg: "var(--info-soft)",    fg: "var(--info)"    },
  neutral: { bg: "var(--surface-2)",    fg: "var(--fg-2)"    },
};

type Props = {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
};

export function Badge({ tone = "neutral", dot = true, children }: Props) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: "var(--r-full)",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        background: t.bg,
        color: t.fg,
        whiteSpace: "nowrap",
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.fg }} />}
      {children}
    </span>
  );
}
