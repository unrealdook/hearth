import { NavLink, useLocation } from "react-router-dom";
import * as Lucide from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type NavItemDef = {
  to: string;
  label: string;
  icon: keyof typeof Lucide;
  count?: number;
  // Extra path prefixes that should also light up this item (for tabbed hubs).
  match?: string[];
};

// "Look at your money" — overview & insight views.
const OVERVIEW: NavItemDef[] = [
  { to: "/",          label: "Dashboard", icon: "LayoutDashboard" },
  { to: "/analytics", label: "Analytics", icon: "BarChart3", match: ["/analytics", "/reports"] },
  { to: "/usage",     label: "Trends",    icon: "Activity",  match: ["/usage", "/fico", "/income-history"] },
  { to: "/ai",        label: "Insights",  icon: "Sparkles" },
];

// "Manage your money" — accounts, flows & data entry.
const MANAGE: NavItemDef[] = [
  { to: "/bills",   label: "Bills",    icon: "Receipt",  match: ["/bills", "/payments"] },
  { to: "/income",  label: "Income",   icon: "TrendingUp" },
  { to: "/debt",    label: "Debt",     icon: "Banknote" },
  { to: "/savings", label: "Accounts", icon: "Wallet",   match: ["/savings", "/investments"] },
  { to: "/business", label: "Business", icon: "Briefcase" },
  { to: "/give",    label: "Give",     icon: "Heart" },
  { to: "/imports", label: "Import",   icon: "Upload" },
];

const SECONDARY: NavItemDef[] = [
  { to: "/settings", label: "Settings", icon: "Settings" },
];

function GroupDivider() {
  return <div style={{ height: 1, background: "var(--border-subtle)", margin: "10px 12px" }} />;
}

function NavItem({ item }: { item: NavItemDef }) {
  const [hover, setHover] = useState(false);
  const Icon = (Lucide as any)[item.icon] || Lucide.Circle;
  const loc = useLocation();
  const prefixes = item.match ?? [item.to];
  const isActive = item.to === "/"
    ? loc.pathname === "/"
    : prefixes.some((p) => loc.pathname === p || loc.pathname.startsWith(p + "/"));
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 12px",
        borderRadius: "var(--r-md)",
        fontSize: 14,
        fontWeight: 500,
        color: isActive ? "var(--fg-1)" : "var(--fg-2)",
        background: isActive || hover ? "var(--surface-2)" : "transparent",
        cursor: "pointer",
        textDecoration: "none",
        transition: "background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease)",
      }}
    >
      <Icon size={18} strokeWidth={1.75} color={isActive ? "var(--brand)" : "var(--fg-2)"} />
      <span>{item.label}</span>
      {item.count != null && (
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: isActive ? "var(--ember-200)" : "var(--fg-3)",
            background: isActive ? "var(--ember-700)" : "var(--surface-3)",
            padding: "2px 7px",
            borderRadius: "var(--r-full)",
          }}
        >
          {item.count}
        </span>
      )}
    </NavLink>
  );
}

export function SideNav() {
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get<{ status: string }[]>("/analytics/upcoming")
      .then((rows) => { if (alive) setOverdue(rows.filter((r) => r.status === "overdue").length); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const manage = MANAGE.map((item) =>
    item.to === "/bills" && overdue > 0 ? { ...item, count: overdue } : item,
  );

  return (
    <nav
      style={{
        width: "var(--rail-w)",
        padding: "16px 16px",
        borderRight: "1px solid var(--border-subtle)",
        background: "var(--surface-0)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flexShrink: 0,
        height: "calc(100vh - var(--topbar-h))",
        position: "sticky",
        top: "var(--topbar-h)",
        overflowY: "auto",
      }}
    >
      {OVERVIEW.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
      <GroupDivider />
      {manage.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
      <div style={{ flex: 1 }} />
      {SECONDARY.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
    </nav>
  );
}
