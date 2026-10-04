import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import {
  Card, Button, Field, Input, Select, Segmented, EmptyState, Badge,
} from "@/components/ui";

type Parsed = {
  doc_type: "paycheck" | "bonus" | "one_off";
  employer: string | null;
  pay_date: string | null;
  period_start: string | null;
  period_end: string | null;
  frequency: string | null;
  description: string | null;
  gross: number | null; net: number | null;
  federal_tax: number | null; state_tax: number | null; fica: number | null;
  retirement_401k: number | null; health: number | null; other: number | null;
  amount: number | null;
  source_file?: string;
};

type IncomeLite = { id: number; source: string };

const num = (v: number | null | undefined) => (v == null ? "" : String(v));

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function IncomeDocImport({ onCreated }: { onCreated?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [incomes, setIncomes] = useState<IncomeLite[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // editable form, seeded from the parse
  const [form, setForm] = useState<any>({});

  async function loadIncomes() {
    try { setIncomes(await api.get<IncomeLite[]>("/income")); } catch {}
  }
  useEffect(() => { loadIncomes(); }, []);

  async function parse() {
    if (!file) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      const d = await api.upload<Parsed>("/income/parse-document", file);
      setParsed(d);
      setForm({
        doc_type: d.doc_type,
        source: d.employer ?? "",
        frequency: d.frequency ?? "biweekly",
        gross: num(d.gross), net: num(d.net),
        federal_tax: num(d.federal_tax), state_tax: num(d.state_tax), fica: num(d.fica),
        retirement_401k: num(d.retirement_401k), health: num(d.health), other: num(d.other),
        // one-off
        income_id: incomes[0]?.id ?? "",
        amount: num(d.amount ?? d.net),
        date: d.pay_date ?? todayISO(),
        kind: d.doc_type === "bonus" ? "bonus" : "payment",
        note: d.description ?? "",
      });
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't read that document.");
    } finally { setBusy(false); }
  }

  function reset() {
    setParsed(null); setFile(null); setForm({}); setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function createPaycheck() {
    setBusy(true); setError(null);
    try {
      await api.post("/income", {
        source: form.source || "New employer",
        type: "salary",
        frequency: form.frequency || "biweekly",
        amount: Number(form.net) || 0,
        gross_amount: form.gross === "" ? null : Number(form.gross),
        federal_tax: form.federal_tax === "" ? null : Number(form.federal_tax),
        state_tax: form.state_tax === "" ? null : Number(form.state_tax),
        fica: form.fica === "" ? null : Number(form.fica),
        retirement_401k_amount: form.retirement_401k === "" ? null : Number(form.retirement_401k),
        health_insurance: form.health === "" ? null : Number(form.health),
        other_deductions: form.other === "" ? null : Number(form.other),
        start_date: parsed?.period_start || parsed?.pay_date || null,
      });
      setSaved(`Created recurring income “${form.source || "New employer"}”.`);
      onCreated?.();
      loadIncomes();
      setParsed(null); setFile(null); setForm({});
      if (inputRef.current) inputRef.current.value = "";
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't save.");
    } finally { setBusy(false); }
  }

  async function logEvent() {
    if (!form.income_id) { setError("Pick which income source this payment belongs to."); return; }
    setBusy(true); setError(null);
    try {
      await api.post(`/income/${form.income_id}/events`, {
        kind: form.kind || "payment",
        occurred_on: form.date || todayISO(),
        amount: Number(form.amount) || 0,
        note: form.note || null,
      });
      const src = incomes.find((i) => i.id === Number(form.income_id))?.source ?? "income";
      setSaved(`Logged ${form.kind === "bonus" ? "bonus" : "payment"} of $${fmtMoney(Number(form.amount) || 0)} to “${src}”.`);
      onCreated?.();
      setParsed(null); setFile(null); setForm({});
      if (inputRef.current) inputRef.current.value = "";
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't save.");
    } finally { setBusy(false); }
  }

  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const isPaycheck = form.doc_type === "paycheck";

  return (
    <>
      {!parsed && (
        <Card>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
            padding: "32px 16px", border: "1px dashed var(--border-default)",
            borderRadius: "var(--r-lg)", background: "var(--surface-inset)",
          }}>
            <div style={{ fontSize: 14, color: "var(--fg-2)", textAlign: "center" }}>
              {file ? file.name : "Upload a pay stub, bonus statement, or a deposit / ACH confirmation (PDF)."}
            </div>
            <input ref={inputRef} type="file" accept=".pdf,.txt" style={{ display: "none" }}
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose file</Button>
              <Button variant="primary" onClick={parse} disabled={!file} loading={busy}>Read it</Button>
            </div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", textAlign: "center", maxWidth: 460 }}>
              Read locally by your own LLM — nothing leaves this machine. Values are pre-filled for you to review before saving.
            </div>
            {saved && <div style={{ fontSize: 13, color: "var(--success)" }}>{saved}</div>}
            {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
          </div>
        </Card>
      )}

      {parsed && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Review what we found</span>
              {parsed.source_file && <Badge tone="neutral">{parsed.source_file}</Badge>}
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>Start over</Button>
          </div>

          <Field label="This document is a…">
            <Segmented
              options={[
                { label: "Paycheck", value: "paycheck" },
                { label: "Bonus", value: "bonus" },
                { label: "One-off / deposit", value: "one_off" },
              ]}
              value={form.doc_type}
              onChange={(v) => set({ doc_type: v, kind: v === "bonus" ? "bonus" : "payment" })}
            />
          </Field>

          {isPaycheck ? (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Field label="Employer / source">
                  <Input value={form.source} onChange={(e) => set({ source: e.target.value })} placeholder="Employer name" />
                </Field>
                <Field label="Frequency">
                  <Select value={form.frequency} onChange={(e) => set({ frequency: e.target.value })}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="semimonthly">Twice a month</option>
                    <option value="monthly">Monthly</option>
                    <option value="annual">Yearly</option>
                  </Select>
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Gross per check"><Input prefix="$" inputMode="decimal" value={form.gross} onChange={(e) => set({ gross: e.target.value })} /></Field>
                <Field label="Net (take-home)"><Input prefix="$" inputMode="decimal" value={form.net} onChange={(e) => set({ net: e.target.value })} /></Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <Field label="Federal"><Input prefix="$" inputMode="decimal" value={form.federal_tax} onChange={(e) => set({ federal_tax: e.target.value })} /></Field>
                <Field label="State"><Input prefix="$" inputMode="decimal" value={form.state_tax} onChange={(e) => set({ state_tax: e.target.value })} /></Field>
                <Field label="FICA"><Input prefix="$" inputMode="decimal" value={form.fica} onChange={(e) => set({ fica: e.target.value })} /></Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <Field label="401(k)"><Input prefix="$" inputMode="decimal" value={form.retirement_401k} onChange={(e) => set({ retirement_401k: e.target.value })} /></Field>
                <Field label="Health"><Input prefix="$" inputMode="decimal" value={form.health} onChange={(e) => set({ health: e.target.value })} /></Field>
                <Field label="Other"><Input prefix="$" inputMode="decimal" value={form.other} onChange={(e) => set({ other: e.target.value })} /></Field>
              </div>
              <Reconcile gross={form.gross} net={form.net}
                         ded={[form.federal_tax, form.state_tax, form.fica, form.retirement_401k, form.health, form.other]} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button variant="primary" onClick={createPaycheck} loading={busy}>Create income source</Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {incomes.length === 0 ? (
                <EmptyState title="No income source to attach to." body="Create an income source first (e.g. a side business), then log this payment against it." icon="TrendingUp" />
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                    <Field label="Attach to source">
                      <Select value={String(form.income_id)} onChange={(e) => set({ income_id: Number(e.target.value) })}>
                        {incomes.map((i) => <option key={i.id} value={i.id}>{i.source}</option>)}
                      </Select>
                    </Field>
                    <Field label="Kind">
                      <Select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
                        <option value="bonus">Bonus</option>
                        <option value="commission">Commission</option>
                        <option value="payment">Payment</option>
                        <option value="tip">Tip</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Date">
                      <Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
                    </Field>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                    <Field label="Amount"><Input prefix="$" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
                    <Field label="Note"><Input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. ACH from Acme LLC" /></Field>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button variant="primary" onClick={logEvent} loading={busy}>Log payment</Button>
                  </div>
                </>
              )}
            </div>
          )}

          {error && <div style={{ marginTop: 12, fontSize: 13, color: "var(--danger)" }}>{error}</div>}
        </Card>
      )}
    </>
  );
}

function Reconcile({ gross, net, ded }: { gross: string; net: string; ded: string[] }) {
  const g = Number(gross) || 0;
  const n = Number(net) || 0;
  const d = ded.reduce((s, x) => s + (Number(x) || 0), 0);
  if (g <= 0) return null;
  const computed = g - d;
  const off = Math.abs(computed - n);
  return (
    <div style={{ fontSize: 12, color: off > 1 ? "var(--warning)" : "var(--fg-3)" }}>
      Gross − deductions = ${fmtMoney(computed)}
      {off > 1
        ? ` · doesn't match net by $${fmtMoney(off)} — check the figures`
        : " · reconciles with net ✓"}
    </div>
  );
}
