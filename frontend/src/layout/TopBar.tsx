import { Bell, Lock, Eye, EyeOff } from "lucide-react";
import { Logo, Input } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { usePrivacy } from "@/hooks/usePrivacy";

type Props = {
  search: string;
  onSearch: (q: string) => void;
};

export function TopBar({ search, onSearch }: Props) {
  const { lock } = useAuth();
  const { on: privacyOn, toggle: togglePrivacy } = usePrivacy();
  return (
    <header
      style={{
        height: "var(--topbar-h)",
        borderBottom: "1px solid var(--border-subtle)",
        background: "rgba(11,12,14,0.8)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 24,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <Logo size={24} />
      <div style={{ flex: 1, maxWidth: 360 }}>
        <Input
          icon="Search"
          placeholder="Find a bill or vendor"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div style={{ flex: 1 }} />
      <button
        aria-label="Notifications"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--fg-2)",
          padding: 8,
          borderRadius: "var(--r-md)",
          display: "inline-flex",
        }}
      >
        <Bell size={18} strokeWidth={1.75} />
      </button>
      <button
        aria-label={privacyOn ? "Show numbers" : "Blur numbers"}
        title={privacyOn ? "Show numbers" : "Blur numbers (demo mode)"}
        onClick={togglePrivacy}
        style={{
          background: privacyOn ? "var(--surface-2)" : "transparent",
          border: "none",
          color: privacyOn ? "var(--brand)" : "var(--fg-2)",
          padding: 8,
          borderRadius: "var(--r-md)",
          display: "inline-flex",
          cursor: "pointer",
          transition: "background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease)",
        }}
      >
        {privacyOn
          ? <EyeOff size={18} strokeWidth={1.75} />
          : <Eye size={18} strokeWidth={1.75} />}
      </button>
      <button
        aria-label="Lock"
        onClick={lock}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--fg-2)",
          padding: 8,
          borderRadius: "var(--r-md)",
          display: "inline-flex",
        }}
      >
        <Lock size={18} strokeWidth={1.75} />
      </button>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--ember-700)",
          color: "var(--ember-100)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        DC
      </div>
    </header>
  );
}
