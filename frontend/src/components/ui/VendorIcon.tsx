import * as Lucide from "lucide-react";
import { VendorKind } from "@/lib/bills";

const ICONS: Record<VendorKind, keyof typeof Lucide> = {
  electric:     "Zap",
  gas:          "Flame",
  water:        "Droplet",
  internet:     "Wifi",
  phone:        "Smartphone",
  rent:         "Home",
  insurance:    "Shield",
  subscription: "PlayCircle",
  credit:       "CreditCard",
  loan:         "Banknote",
  other:        "Receipt",
};

type Props = { kind?: string; size?: number };

export function VendorIcon({ kind = "other", size = 36 }: Props) {
  const iconName = (ICONS as any)[kind] || "Receipt";
  const Icon = (Lucide as any)[iconName] || Lucide.Receipt;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--fg-2)",
        flexShrink: 0,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.5} />
    </div>
  );
}
