import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { PrivacyProvider } from "@/hooks/usePrivacy";
import { AppShell } from "@/layout/AppShell";
import { LockScreen } from "@/pages/LockScreen";
import { Dashboard } from "@/pages/Dashboard";
import { Bills } from "@/pages/Bills";
import { Payments } from "@/pages/Payments";
import { Income } from "@/pages/Income";
import { Debt } from "@/pages/Debt";
import { Savings } from "@/pages/Savings";
import { Investments } from "@/pages/Investments";
import { Give } from "@/pages/Give";
import { Business } from "@/pages/Business";
import { Reports } from "@/pages/Reports";
import { ImportPage } from "@/pages/Import";
import { Usage } from "@/pages/Usage";
import { Analytics } from "@/pages/Analytics";
import { AIInsights } from "@/pages/AIInsights";
import { Fico } from "@/pages/Fico";
import { IncomeTrend } from "@/pages/IncomeTrend";
import { Settings } from "@/pages/Settings";
import { Hub, HubTab } from "@/pages/Hub";

// Combined nav items: each path renders the same Hub so the segmented control
// switches tabs while every original URL keeps working (no broken links).
const BILLS_TABS: HubTab[] = [
  { label: "Bills", path: "/bills", element: <Bills /> },
  { label: "Payments", path: "/payments", element: <Payments /> },
];
const ACCOUNTS_TABS: HubTab[] = [
  { label: "Savings", path: "/savings", element: <Savings /> },
  { label: "Investments", path: "/investments", element: <Investments /> },
];
const ANALYTICS_TABS: HubTab[] = [
  { label: "Analytics", path: "/analytics", element: <Analytics /> },
  { label: "Reports", path: "/reports", element: <Reports /> },
];
const TRENDS_TABS: HubTab[] = [
  { label: "Usage", path: "/usage", element: <Usage /> },
  { label: "Income", path: "/income-history", element: <IncomeTrend /> },
  { label: "FICO", path: "/fico", element: <Fico /> },
];
import { Spinner, Logo, Button } from "@/components/ui";

function Gate() {
  const { status, refresh } = useAuth();

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner size={24} />
      </div>
    );
  }

  if (status === "backend_down") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--surface-0)",
        }}
      >
        <div style={{ marginBottom: 56 }}>
          <Logo size={32} />
        </div>
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-xl)",
            padding: 40,
            width: 420,
            maxWidth: "100%",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>
            Can't reach the backend
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--fg-2)" }}>
            The Hearth backend isn't responding on <code style={{ fontFamily: "var(--font-mono)" }}>127.0.0.1:5274</code>.
            Start it with <code style={{ fontFamily: "var(--font-mono)" }}>start.bat</code> (or check the backend window for errors).
          </div>
          <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
            <Button onClick={() => refresh()} icon="RefreshCw">Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "needs_setup") return <LockScreen mode="setup" />;
  if (status === "locked") return <LockScreen mode="unlock" />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bills" element={<Hub tabs={BILLS_TABS} />} />
        <Route path="/payments" element={<Hub tabs={BILLS_TABS} />} />
        <Route path="/income" element={<Income />} />
        <Route path="/debt" element={<Debt />} />
        <Route path="/savings" element={<Hub tabs={ACCOUNTS_TABS} />} />
        <Route path="/investments" element={<Hub tabs={ACCOUNTS_TABS} />} />
        <Route path="/give" element={<Give />} />
        <Route path="/business" element={<Business />} />
        <Route path="/reports" element={<Hub tabs={ANALYTICS_TABS} />} />
        <Route path="/imports" element={<ImportPage />} />
        <Route path="/usage" element={<Hub tabs={TRENDS_TABS} />} />
        <Route path="/income-history" element={<Hub tabs={TRENDS_TABS} />} />
        <Route path="/analytics" element={<Hub tabs={ANALYTICS_TABS} />} />
        <Route path="/ai" element={<AIInsights />} />
        <Route path="/fico" element={<Hub tabs={TRENDS_TABS} />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PrivacyProvider>
        <Gate />
      </PrivacyProvider>
    </AuthProvider>
  );
}
