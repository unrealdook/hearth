import { ReactNode } from "react";
import * as Lucide from "lucide-react";

type Props = {
  icon?: keyof typeof Lucide;
  title: string;
  body?: string;
  action?: ReactNode;
};

export function EmptyState({ icon = "Inbox", title, body, action }: Props) {
  const Icon = (Lucide as any)[icon] || Lucide.Inbox;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "48px 24px",
        gap: 12,
        color: "var(--fg-2)",
      }}
    >
      <Icon size={32} strokeWidth={1.25} color="var(--fg-3)" />
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: "var(--fg-2)", maxWidth: 360 }}>{body}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
