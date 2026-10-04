import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Wand2, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  Card, Button, Eyebrow, EmptyState, Badge, Switch, Input, Select, Segmented,
} from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";
import { IncomeDocImport } from "@/components/income/IncomeDocImport";
import {
  CategorySelect, TeachRuleModal, ManageModal, type Category, type Rule,
} from "@/components/categories/CategoryTools";

type ImportRow = {
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string;
  matched_bill_id: number | null;
  fingerprint: string;
  suggest?: string;
  duplicate?: boolean;
  mark_paid?: boolean;
};

type ImportResult = {
  rows: ImportRow[]; source_file: string; count: number;
  new_count?: number; duplicate_count?: number;
};

type SortCol = "date" | "description" | "category" | "amount";

type Reconcile = {
  account: { id: number; name: string; balance: number };
  status: "ok" | "no_anchor";
  message?: string;
  as_of?: string;
  source_file?: string;
  statement_balance?: number;
  deducted_since?: number;
  deductions?: { bill: string; amount: number; paid_date: string }[];
  expected_balance?: number;
  drift?: number;
  reconciled?: boolean;
};

/** Does Hearth's balance still match the bank's?
 *
 *  The statement prints a running balance after every line — that's the bank's
 *  own figure. Anything recorded since should explain the difference; whatever's
 *  left over is drift, which is what quietly accumulates in a hand-kept balance. */
function ReconcilePanel() {
  const [accounts, setAccounts] = useState<{ id: number; name: string }[]>([]);
  const [accountId, setAccountId] = useState<number | "">("");
  const [data, setData] = useState<Reconcile | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function check(id?: number | "") {
    setBusy(true);
    try {
      const q = id ? `?account_id=${id}` : "";
      setData(await api.get<Reconcile>(`/import/reconcile${q}`));
    } catch { setData(null); } finally { setBusy(false); }
  }

  useEffect(() => {
    api.get<{ id: number; name: string; bucket: string }[]>("/savings/accounts")
      .then((a) => setAccounts(a))
      .catch(() => {});
    check();
  }, []);

  if (!data) return null;
  const ok = data.status === "ok";
  const drift = data.drift ?? 0;
  const clean = data.reconciled;

  return (
    <Card style={{ marginBottom: 16, borderColor: ok && !clean ? "var(--warning)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>Balance check</Eyebrow>
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--fg-2)" }}>
            {!ok ? data.message : clean ? (
              <>
                <strong style={{ color: "var(--success)" }}>{data.account.name} matches the bank.</strong>{" "}
                ${fmtMoney(data.account.balance)} as expected from the {fmtDate(data.as_of!)} statement.
              </>
            ) : (
              <>
                <strong style={{ color: "var(--warning)" }}>
                  {data.account.name} is off by ${fmtMoney(Math.abs(drift))}
                </strong>{" "}
                {drift > 0 ? "more" : "less"} than expected. Bank said ${fmtMoney(data.statement_balance!)} on{" "}
                {fmtDate(data.as_of!)}; ${fmtMoney(data.deducted_since!)} recorded since leaves{" "}
                ${fmtMoney(data.expected_balance!)}, but Hearth shows ${fmtMoney(data.account.balance)}.
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {accounts.length > 1 && (
            <Select value={String(accountId)} style={{ width: 190 }}
                    onChange={(e) => {
                      const v = e.target.value === "" ? "" : Number(e.target.value);
                      setAccountId(v); check(v);
                    }}>
              <option value="">Default account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
          <Button variant="ghost" size="sm" icon="RefreshCw" loading={busy}
                  onClick={() => check(accountId)}>{""}</Button>
          {ok && (data.deductions ?? []).length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Details"}
            </Button>
          )}
        </div>
      </div>

      {open && ok && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 8 }}>
            Recorded since the {fmtDate(data.as_of!)} statement
            {data.source_file ? ` (${data.source_file})` : ""}
          </div>
          {(data.deductions ?? []).map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--fg-2)" }}>{d.bill} <span style={{ color: "var(--fg-4)" }}>· {fmtDate(d.paid_date)}</span></span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>−${fmtMoney(d.amount)}</span>
            </div>
          ))}
          {!clean && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--fg-3)" }}>
              A gap usually means spending the bank has posted but Hearth hasn't imported yet —
              import the latest statement, then check again.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SortHead({ label, col, sortKey, sortDir, onSort, align }: {
  label: string; col: SortCol; sortKey: SortCol; sortDir: "asc" | "desc";
  onSort: (k: SortCol) => void; align?: "right";
}) {
  const active = sortKey === col;
  return (
    <button
      onClick={() => onSort(col)}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        background: "none", border: "none", padding: 0, cursor: "pointer",
        textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, fontSize: 11,
        color: active ? "var(--fg-1)" : "var(--fg-3)",
      }}
    >
      {label}{active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );
}

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [mode, setMode] = useState<"bank" | "income">("bank");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [showManage, setShowManage] = useState(false);
  const [teach, setTeach] = useState<{ keyword: string; category: string } | null>(null);
  const [sortKey, setSortKey] = useState<"date" | "description" | "category" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hideDupes, setHideDupes] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const RECENT_GRID = "34px 96px minmax(0,1fr) 150px 136px 92px 30px";

  async function loadRecent() {
    try {
      setRecent(await api.get("/import/transactions?limit=200"));
      setSelected(new Set());
    } catch {}
  }
  async function loadCats() {
    try {
      const [c, r, b] = await Promise.all([
        api.get<Category[]>("/categories"),
        api.get<Rule[]>("/categories/rules"),
        api.get<any[]>("/bills"),
      ]);
      setCategories(c); setRules(r); setBills(b);
    } catch {}
  }
  useEffect(() => { loadRecent(); loadCats(); }, []);

  async function setCategoryFor(id: number, category: string) {
    setRecent((prev) => prev.map((t) => (t.id === id ? { ...t, category } : t)));
    try { await api.put(`/import/transactions/${id}`, { category }); } catch { loadRecent(); }
  }

  async function assignBill(tx: any, billIdStr: string) {
    const bid = billIdStr ? Number(billIdStr) : null;
    setRecent((prev) => prev.map((t) => (t.id === tx.id ? { ...t, matched_bill_id: bid } : t)));
    try {
      const res = await api.put<{ linked: number; merchant: string }>(
        `/import/transactions/${tx.id}`, { matched_bill_id: bid, apply_merchant: true });
      await loadRecent();
      const billName = bills.find((b) => b.id === bid)?.name;
      if (res.linked > 1) {
        alert(bid
          ? `Linked ${res.linked} "${res.merchant}" transactions to ${billName}.`
          : `Cleared the bill from ${res.linked} "${res.merchant}" transactions.`);
      }
    } catch { loadRecent(); }
  }

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); }
    else { setSortKey(key); setSortDir(key === "date" || key === "amount" ? "desc" : "asc"); }
  }

  const sortedRecent = [...recent].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let av: any, bv: any;
    if (sortKey === "amount") { av = a.amount; bv = b.amount; }
    else if (sortKey === "date") { av = a.date; bv = b.date; }
    else { av = (a[sortKey] || "").toLowerCase(); bv = (b[sortKey] || "").toLowerCase(); }
    return av < bv ? -dir : av > bv ? dir : 0;
  });

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === recent.length ? new Set() : new Set(recent.map((r) => r.id)),
    );
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected transaction${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const r = await api.post<{ deleted: number }>("/import/transactions/delete", { ids: [...selected] });
      await loadRecent();
      alert(`Deleted ${r.deleted} transaction${r.deleted === 1 ? "" : "s"}.`);
    } finally { setDeleting(false); }
  }

  async function deleteRange() {
    if (!rangeStart && !rangeEnd) { alert("Pick a start and/or end date first."); return; }
    const label = `${rangeStart || "the beginning"} to ${rangeEnd || "now"}`;
    if (!confirm(`Delete every imported transaction dated ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const r = await api.post<{ deleted: number }>("/import/transactions/delete", {
        start: rangeStart || undefined,
        end: rangeEnd || undefined,
      });
      setRangeStart(""); setRangeEnd("");
      await loadRecent();
      alert(`Deleted ${r.deleted} transaction${r.deleted === 1 ? "" : "s"} in that range.`);
    } finally { setDeleting(false); }
  }

  async function uploadFile() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.upload<ImportResult>("/import/bank-statement", file);
      setResult(r);
    } catch (e: any) {
      setError(e?.message || "Could not parse that file.");
    } finally { setBusy(false); }
  }

  async function confirmAll() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await api.post<{ saved: number; duplicates: number; auto_paid: number }>(
        "/import/confirm",
        { rows: result.rows, source_file: result.source_file },
      );
      setResult(null);
      setFile(null);
      loadRecent();
      alert(`Imported ${r.saved} new transactions. Duplicates skipped: ${r.duplicates}. Bills marked paid: ${r.auto_paid}.`);
    } finally { setBusy(false); }
  }

  function setRow(idx: number, patch: Partial<ImportRow>) {
    if (!result) return;
    const rows = result.rows.slice();
    rows[idx] = { ...rows[idx], ...patch };
    setResult({ ...result, rows });
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 className="t-h2" style={{ margin: 0 }}>Import</h1>
        <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
          {mode === "bank"
            ? "Drop a bank statement (CSV or PDF). We'll categorize and try to match each line to a bill."
            : "Read a pay stub, bonus statement, or deposit confirmation with your local LLM, then review before saving."}
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Segmented
          options={[{ label: "Bank statement", value: "bank" }, { label: "Income doc", value: "income" }]}
          value={mode}
          onChange={(v) => setMode(v as "bank" | "income")}
        />
      </div>

      {mode === "income" ? (
        <IncomeDocImport />
      ) : (
      <>
      {!result && <ReconcilePanel />}
      {!result && (
        <Card>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: "32px 16px",
              border: "1px dashed var(--border-default)",
              borderRadius: "var(--r-lg)",
              background: "var(--surface-inset)",
            }}
          >
            <Upload size={28} strokeWidth={1.5} color="var(--fg-3)" />
            <div style={{ fontSize: 14, color: "var(--fg-2)", textAlign: "center" }}>
              {file ? file.name : "Pick a CSV or PDF bank statement to upload."}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.pdf"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                Choose file
              </Button>
              <Button variant="primary" onClick={uploadFile} disabled={!file} loading={busy}>
                Upload & parse
              </Button>
            </div>
            {error && (
              <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>
            )}
          </div>
        </Card>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {result.count} parsed · <span style={{ color: "var(--success)" }}>{result.new_count ?? result.count} new</span>
                {(result.duplicate_count ?? 0) > 0 && (
                  <span style={{ color: "var(--fg-3)" }}> · {result.duplicate_count} already imported</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{result.source_file}</div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {(result.duplicate_count ?? 0) > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--fg-2)", cursor: "pointer" }}>
                  <input type="checkbox" checked={hideDupes} onChange={(e) => setHideDupes(e.target.checked)} style={{ cursor: "pointer" }} />
                  Hide already-imported
                </label>
              )}
              <Button variant="ghost" onClick={() => { setResult(null); setFile(null); }}>Discard</Button>
              <Button variant="primary" onClick={confirmAll} loading={busy}>Save {result.new_count ?? result.count} new</Button>
            </div>
          </div>
          <Card padding={0}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "100px 1fr 110px 130px 110px 100px",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-subtle)",
                fontSize: 11, fontWeight: 600, color: "var(--fg-3)",
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}
            >
              <span>Date</span>
              <span>Description</span>
              <span>Category</span>
              <span>Matched bill</span>
              <span style={{ textAlign: "right" }}>Amount</span>
              <span>Mark paid</span>
            </div>
            {result.rows.map((r, idx) => (
              hideDupes && r.duplicate ? null : (
              <div
                key={r.fingerprint}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr 110px 130px 110px 100px",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: 13,
                  opacity: r.duplicate ? 0.5 : 1,
                }}
              >
                <span style={{ color: "var(--fg-2)" }}>{fmtDate(r.date)}</span>
                <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.description}
                  {r.duplicate && <Badge tone="neutral">already imported</Badge>}
                </span>
                <CategorySelect
                  value={r.category ?? ""}
                  categories={categories}
                  onChange={(v) => setRow(idx, { category: v })}
                />
                <span style={{ color: "var(--fg-2)" }}>
                  {r.matched_bill_id ? <Badge tone="info">bill #{r.matched_bill_id}</Badge> : <Badge tone="neutral">—</Badge>}
                </span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: r.amount < 0 ? "var(--fg-1)" : "var(--success)" }}>
                  <Private strength={9}>{r.amount < 0 ? "-" : "+"}${fmtMoney(Math.abs(r.amount))}</Private>
                </span>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  {r.matched_bill_id ? (
                    <Switch on={!!r.mark_paid} onChange={(v) => setRow(idx, { mark_paid: v })} />
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--fg-4)" }}>—</span>
                  )}
                </div>
              </div>
              )
            ))}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <Eyebrow>Recent imports</Eyebrow>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => setShowManage(true)}>
              <SlidersHorizontal size={15} strokeWidth={1.75} /> Categories & rules
            </Button>
            <div>
              <label style={{ fontSize: 11, color: "var(--fg-3)", display: "block", marginBottom: 2 }}>From</label>
              <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} containerStyle={{ height: 32 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--fg-3)", display: "block", marginBottom: 2 }}>To</label>
              <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} containerStyle={{ height: 32 }} />
            </div>
            <Button variant="danger" onClick={deleteRange} loading={deleting} disabled={!rangeStart && !rangeEnd}>
              <Trash2 size={15} strokeWidth={1.75} /> Delete in range
            </Button>
            <Button variant="danger" onClick={deleteSelected} loading={deleting} disabled={selected.size === 0}>
              <Trash2 size={15} strokeWidth={1.75} /> Delete selected{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {recent.length === 0 ? (
            <Card><EmptyState title="No imports yet." icon="FileText" /></Card>
          ) : (
            <Card padding={0}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: RECENT_GRID,
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: 11, fontWeight: 600, color: "var(--fg-3)",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={recent.length > 0 && selected.size === recent.length}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < recent.length; }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer" }}
                />
                <SortHead label="Date" col="date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Description" col="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Category" col="category" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <span>Bill</span>
                <SortHead label="Amount" col="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <span></span>
              </div>
              {sortedRecent.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: RECENT_GRID,
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border-subtle)",
                    fontSize: 13,
                    background: selected.has(r.id) ? "var(--surface-inset)" : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.description}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggleRow(r.id)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ color: "var(--fg-2)" }}>{fmtDate(r.date)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</span>
                  <CategorySelect value={r.category || ""} categories={categories} onChange={(v) => setCategoryFor(r.id, v)} />
                  <Select value={String(r.matched_bill_id ?? "")} onChange={(e) => assignBill(r, e.target.value)} containerStyle={{ height: 32 }}>
                    <option value="">— None —</option>
                    {bills.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                    <Private strength={9}>{r.amount < 0 ? "-" : "+"}${fmtMoney(Math.abs(r.amount))}</Private>
                  </span>
                  <button
                    title="Remember this merchant's category"
                    onClick={() => setTeach({ keyword: r.suggest || "", category: r.category || "" })}
                    style={{ border: "none", background: "none", color: "var(--fg-3)", cursor: "pointer", display: "flex", justifyContent: "center", padding: 0 }}
                  >
                    <Wand2 size={15} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
      </>
      )}

      <ManageModal
        open={showManage}
        onClose={() => setShowManage(false)}
        categories={categories}
        rules={rules}
        onChanged={() => { loadCats(); loadRecent(); }}
        notify={(m) => alert(m)}
      />
      {teach && (
        <TeachRuleModal
          open={!!teach}
          onClose={() => setTeach(null)}
          initialKeyword={teach.keyword}
          initialCategory={teach.category}
          categories={categories}
          onSaved={(m) => { alert(m); loadCats(); loadRecent(); }}
        />
      )}
    </>
  );
}
