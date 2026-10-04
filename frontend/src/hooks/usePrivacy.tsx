/**
 * Privacy mode — when on, every numeric value in the app is blurred so the
 * user can demo without revealing real balances. The toggle lives in the topbar.
 *
 * State is persisted in localStorage so refreshes don't kick you back out of
 * demo mode mid-presentation.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const STORAGE_KEY = "hearth.privacy";

type Ctx = {
  on: boolean;
  toggle: () => void;
  set: (v: boolean) => void;
};

const C = createContext<Ctx | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, on ? "1" : "0"); } catch {}
  }, [on]);

  return (
    <C.Provider value={{ on, toggle: () => setOn((v) => !v), set: setOn }}>
      {children}
    </C.Provider>
  );
}

export function usePrivacy(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("usePrivacy must be used inside PrivacyProvider");
  return v;
}

/**
 * Inline wrapper for ad-hoc numeric content that doesn't go through <Amount/>.
 * Apply this to FICO scores, raw $ in dashboard cards, transaction tables, etc.
 *
 * Pass `strength` to override the blur radius — larger text needs more pixels
 * to fully obscure the digits. Default = 14, which works for ~32-56px text;
 * use ~9 for table rows and inline percentages.
 */
export function Private({ children, strength = 14 }: { children: ReactNode; strength?: number }) {
  const { on } = usePrivacy();
  if (!on) return <>{children}</>;
  return (
    <span
      aria-hidden
      style={{
        filter: `blur(${strength}px)`,
        userSelect: "none",
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}
