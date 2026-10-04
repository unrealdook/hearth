import { useEffect, useRef, useState } from "react";
import { Logo, Spinner } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

type Props = { mode: "setup" | "unlock" };

export function LockScreen({ mode }: Props) {
  const { setup, unlock } = useAuth();
  const [pass, setPass] = useState<string>("");
  const [confirmPass, setConfirmPass] = useState<string>("");
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [stage, mode]);

  async function submit(value: string) {
    setError(null);
    setBusy(true);
    try {
      if (mode === "setup") {
        if (stage === "enter") {
          setConfirmPass("");
          setStage("confirm");
          setPass("");
        } else {
          if (value !== confirmPass) {
            // value is the second entry, confirmPass holds the first
            setError("Those didn't match. Try again.");
            setStage("enter");
            setPass("");
            setConfirmPass("");
          } else {
            await setup(value);
          }
        }
      } else {
        await unlock(value);
      }
    } catch (e: any) {
      if (mode === "unlock" && e instanceof ApiError && e.status === 401) {
        setError("That's not the right passcode.");
      } else if (e instanceof ApiError) {
        setError(e.message || `Backend error (${e.status}).`);
      } else {
        setError("Couldn't reach the backend. Is it running on port 5274?");
      }
      setPass("");
    } finally {
      setBusy(false);
    }
  }

  function onChange(v: string) {
    setError(null);
    const cleaned = v.replace(/\D/g, "").slice(0, 4);
    setPass(cleaned);
    if (cleaned.length === 4 && !busy) {
      if (mode === "setup" && stage === "enter") {
        setConfirmPass(cleaned);
        setStage("confirm");
        setPass("");
        return;
      }
      submit(cleaned);
    }
  }

  const heading =
    mode === "setup"
      ? stage === "enter" ? "Set a 4-digit passcode" : "Enter it again to confirm"
      : "Welcome back";
  const sub =
    mode === "setup"
      ? "You'll use this to unlock Hearth and decrypt stored bill credentials."
      : "Enter your 4-digit passcode to unlock.";

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
          {heading}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--fg-2)" }}>{sub}</div>

        <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: i < pass.length ? "var(--brand)" : "var(--surface-3)",
                transition: "background var(--dur-micro) var(--ease)",
              }}
            />
          ))}
        </div>

        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pass}
          onChange={(e) => onChange(e.target.value)}
          maxLength={4}
          aria-label="4-digit passcode"
          style={{
            position: "absolute",
            opacity: 0,
            pointerEvents: "none",
            width: 0,
            height: 0,
          }}
        />
        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            marginTop: 24,
            fontSize: 12,
            color: "var(--fg-3)",
            cursor: "text",
          }}
        >
          Tap to enter passcode
        </div>

        {busy && (
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
            <Spinner />
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 20,
              padding: "8px 12px",
              borderRadius: "var(--r-md)",
              background: "var(--danger-soft)",
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ marginTop: 40, fontSize: 12, color: "var(--fg-3)", textAlign: "center", maxWidth: 360 }}>
        Hearth runs locally on your machine. Nothing leaves this device.
      </div>
    </div>
  );
}
