import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { Card, Button, Eyebrow, Field, Input } from "@/components/ui";

export function Settings() {
  const { changePasscode, lock } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function changePass() {
    setMsg(null); setErr(null);
    if (!/^\d{4}$/.test(current) || !/^\d{4}$/.test(next)) {
      setErr("Both passcodes must be exactly 4 digits.");
      return;
    }
    if (next !== confirm) {
      setErr("New passcode and confirmation don't match.");
      return;
    }
    setBusy(true);
    try {
      await changePasscode(current, next);
      setMsg("Passcode changed. Stored credentials must be re-entered on each bill.");
    } catch (e: any) {
      setErr(e?.payload?.message || e?.message || "Could not change passcode.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 className="t-h2" style={{ margin: 0 }}>Settings</h1>
        <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
          Local-only. Nothing here syncs anywhere.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
        <Card>
          <Eyebrow>Passcode</Eyebrow>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Current passcode">
              <Input
                type="password"
                inputMode="numeric"
                value={current}
                onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
              />
            </Field>
            <Field label="New passcode">
              <Input
                type="password"
                inputMode="numeric"
                value={next}
                onChange={(e) => setNext(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
              />
            </Field>
            <Field label="Confirm new">
              <Input
                type="password"
                inputMode="numeric"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
              />
            </Field>
            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
              Heads up: changing the passcode invalidates the encryption key, so you'll need to re-enter
              stored bill usernames and passwords.
            </div>
            {msg && (
              <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "var(--success-soft)", color: "var(--success)", fontSize: 13 }}>{msg}</div>
            )}
            {err && (
              <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>{err}</div>
            )}
            <div>
              <Button variant="primary" onClick={changePass} loading={busy}>Change passcode</Button>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Session</Eyebrow>
          <div style={{ marginTop: 16, fontSize: 13, color: "var(--fg-2)" }}>
            Lock the app when you step away. The next person who opens it will need your passcode.
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="secondary" icon="Lock" onClick={lock}>Lock now</Button>
          </div>
        </Card>

        <BackupCard />

        <Card>
          <Eyebrow>About</Eyebrow>
          <div style={{ marginTop: 16, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 }}>
            Hearth is a local personal finance tracker. Data lives in <code style={{ fontFamily: "var(--font-mono)" }}>backend/data/finance.db</code>.
            Bill credentials are encrypted with a Fernet key derived from your passcode (PBKDF2). The app
            binds to 127.0.0.1 only — nothing is exposed to your network.
          </div>
        </Card>
      </div>
    </>
  );
}

function BackupCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function getDownload(path: string, fallback: string) {
    const res = await fetch(`/api${path}`, { headers: { "X-Hearth-Session": localStorage.getItem("hearth.session") || "" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = m ? m[1] : fallback;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function doBackup() {
    setBusy("backup"); setMsg(null);
    try { await getDownload("/backup", "hearth-backup.hbk"); setMsg({ tone: "info", text: "Encrypted backup downloaded. Store it somewhere safe." }); }
    catch (e: any) { setMsg({ tone: "danger", text: e?.message || "Backup failed." }); }
    finally { setBusy(null); }
  }
  async function doExport() {
    setBusy("export"); setMsg(null);
    try { await getDownload("/export", "hearth-export.zip"); setMsg({ tone: "info", text: "CSV export downloaded." }); }
    catch (e: any) { setMsg({ tone: "danger", text: e?.message || "Export failed." }); }
    finally { setBusy(null); }
  }
  async function doRestore(file: File) {
    if (!confirm("Restore will REPLACE your current data with this backup. A safety copy of the current database is kept. Continue?")) return;
    setBusy("restore"); setMsg(null);
    try {
      await api.upload("/backup/restore", file);
      setMsg({ tone: "warning", text: "Restored. Restart the backend (start.bat) for it to take effect." });
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.payload?.message || e?.message || "Restore failed." });
    } finally { setBusy(null); }
  }

  return (
    <Card>
      <Eyebrow>Backup & export</Eyebrow>
      <div style={{ marginTop: 12, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 }}>
        Download an <strong>encrypted</strong> copy of everything (safe to keep in the cloud — it's locked to your passcode),
        or export plain CSVs for your accountant. Credentials are never included in the CSV export.
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" icon="Download" loading={busy === "backup"} onClick={doBackup}>Download backup</Button>
        <Button variant="secondary" icon="FileText" loading={busy === "export"} onClick={doExport}>Export CSVs</Button>
        <input ref={fileRef} type="file" accept=".hbk" style={{ display: "none" }}
               onChange={(e) => { const f = e.target.files?.[0]; if (f) doRestore(f); e.currentTarget.value = ""; }} />
        <Button variant="ghost" icon="Upload" loading={busy === "restore"} onClick={() => fileRef.current?.click()}>Restore…</Button>
      </div>
      {msg && (
        <div style={{ marginTop: 14, padding: "8px 12px", borderRadius: "var(--r-md)", fontSize: 13,
                      background: "var(--surface-inset)", border: "1px solid var(--border-subtle)",
                      color: msg.tone === "danger" ? "var(--danger)" : msg.tone === "warning" ? "var(--warning)" : "var(--fg-2)" }}>
          {msg.text}
        </div>
      )}
    </Card>
  );
}
