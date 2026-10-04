import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Segmented } from "@/components/ui";

export type HubTab = { label: string; path: string; element: ReactNode };

/**
 * Hosts several closely-related pages under one nav item, switched by a
 * segmented control. The active tab is driven by the URL so deep links,
 * back/forward, and nav highlighting all keep working.
 */
export function Hub({ tabs }: { tabs: HubTab[] }) {
  const loc = useLocation();
  const nav = useNavigate();
  const active = tabs.find((t) => loc.pathname === t.path) ?? tabs[0];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Segmented
          options={tabs.map((t) => ({ label: t.label, value: t.path }))}
          value={active.path}
          onChange={(p) => nav(p)}
        />
      </div>
      {active.element}
    </div>
  );
}
