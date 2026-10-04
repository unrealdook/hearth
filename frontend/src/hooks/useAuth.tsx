import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { api, getToken, setToken, ApiError } from "@/lib/api";

type AuthStatus = "loading" | "needs_setup" | "locked" | "unlocked" | "backend_down";

type AuthCtx = {
  status: AuthStatus;
  setup: (passcode: string) => Promise<void>;
  unlock: (passcode: string) => Promise<void>;
  lock: () => Promise<void>;
  changePasscode: (current: string, next: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  // Count consecutive health failures so a normal slow boot keeps the spinner up
  // instead of flashing the "backend down" card for the first couple of seconds.
  const failCount = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const health = await api.get<{ ok: boolean; auth_configured: boolean }>("/health");
      failCount.current = 0;
      if (!health.auth_configured) {
        setStatus("needs_setup");
        return;
      }
      // session token may be present and valid — try a protected ping
      if (!getToken()) {
        setStatus("locked");
        return;
      }
      try {
        await api.get("/budget"); // any protected endpoint
        setStatus("unlocked");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setStatus("locked");
        else throw e;
      }
    } catch (e) {
      failCount.current += 1;
      // Give the backend ~4.5s (3 polls) to finish booting before alarming the user.
      if (failCount.current >= 3) {
        console.error("[hearth] auth refresh failed — backend may be unreachable", e);
        setStatus("backend_down");
      }
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // The backend takes a few seconds to boot (DB create + schema migrate), while
  // Vite serves instantly. Rather than dumping the user on the "backend down"
  // card and making them click Retry, keep polling while we're still waiting on
  // the backend — it auto-clears the moment /health answers.
  useEffect(() => {
    if (status !== "loading" && status !== "backend_down") return;
    const id = setInterval(() => { refresh(); }, 1500);
    return () => clearInterval(id);
  }, [status, refresh]);

  // when any API call hits 401, jump to the lock screen instead of leaving the user stuck
  useEffect(() => {
    function onExpired() { setStatus("locked"); }
    window.addEventListener("hearth-auth-expired", onExpired);
    return () => window.removeEventListener("hearth-auth-expired", onExpired);
  }, []);

  const setup = async (passcode: string) => {
    const r = await api.post<{ ok: boolean; token: string }>("/auth/setup", { passcode });
    setToken(r.token);
    setStatus("unlocked");
  };

  const unlock = async (passcode: string) => {
    const r = await api.post<{ ok: boolean; token: string }>("/auth/unlock", { passcode });
    setToken(r.token);
    setStatus("unlocked");
  };

  const lock = async () => {
    try { await api.post("/auth/lock"); } catch {}
    setToken(null);
    setStatus("locked");
  };

  const changePasscode = async (current: string, next: string) => {
    await api.post("/auth/change-passcode", { current, new: next });
    await lock();
  };

  return (
    <Ctx.Provider value={{ status, setup, unlock, lock, changePasscode, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
