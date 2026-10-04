import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney, ordinalDay } from "@/lib/format";
import {
  Card, Button, Badge, VendorIcon, Amount, Eyebrow, Spinner, EmptyState, Input, Switch,
} from "@/components/ui";
import { BILL_CATEGORIES } from "@/lib/bills";
import { Bill, EMPTY_BILL } from "@/types/bill";
import { BillDetailPanel } from "@/components/bills/BillDetailPanel";
import { BillEditor } from "@/components/bills/BillEditor";

const STATUS_LABEL: Record<Bill["status"], string> = {
  active: "Active",
  paused: "Paused",
  paid_off: "Paid off",
  paid_off_open: "Paid off",
};
const STATUS_TONE: Record<Bill["status"], "neutral" | "warning" | "paid"> = {
  active: "neutral",
  paused: "warning",
  paid_off: "paid",
  paid_off_open: "paid",
};

/** Still costs money each month — a closed-out or paused bill doesn't. */
const isLive = (b: Bill) => b.is_active;

export function Bills() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(Bill | typeof EMPTY_BILL) | null>(null);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [tab, setTab] = useState<"bills" | "expenses">("bills");

  async function load() {
    setLoading(true);
    try {
      setBills(await api.get<Bill[]>("/bills"));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveBillInline(id: number, patch: any) {
    await api.put(`/bills/${id}`, patch);
    load();
  }

  const liveBills = useMemo(() => bills.filter(isLive), [bills]);

  const grouped = useMemo(() => {
    const out: Record<string, Bill[]> = {};
    for (const b of bills) {
      const k = b.category || "Other";
      (out[k] ||= []).push(b);
    }
    const known = BILL_CATEGORIES.filter((c) => out[c]);
    const unknown = Object.keys(out).filter((k) => !BILL_CATEGORIES.includes(k as any)).sort();
    return [...known, ...unknown].map((k) => [k, out[k]] as const);
  }, [bills]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Bills</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            {bills.length === 0
              ? "No bills yet."
              : `${liveBills.length} active, $${fmtMoney(liveBills.reduce((s, b) => s + b.amount, 0))} a month`
                + (bills.length - liveBills.length > 0 ? ` · ${bills.length - liveBills.length} paid off or paused` : "")}
          </p>
        </div>
        {tab === "bills" && <Button icon="Plus" onClick={() => setEditing(EMPTY_BILL)}>Add a bill</Button>}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border-subtle)" }}>
        {([["bills", "Bills"], ["expenses", "Expenses"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 14px", fontSize: 14, fontFamily: "inherit",
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? "var(--fg-1)" : "var(--fg-3)",
              borderBottom: tab === key ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "expenses" ? (
        <ExpensesTab />
      ) : loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : bills.length === 0 ? (
        <Card>
          <EmptyState
            title="No bills yet."
            body="Add your first bill to start tracking what you owe each month."
            icon="Receipt"
            action={<Button icon="Plus" onClick={() => setEditing(EMPTY_BILL)}>Add a bill</Button>}
          />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <Eyebrow>{cat}</Eyebrow>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                  · {items.length} · ${fmtMoney(items.filter(isLive).reduce((s, b) => s + b.amount, 0))}
                </span>
              </div>
              <Card padding={0} style={{ overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 1fr auto auto auto auto",
                    alignItems: "center",
                    gap: 16,
                    padding: "12px 20px",
                    borderBottom: "1px solid var(--border-subtle)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--fg-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  <span></span>
                  <span>Bill</span>
                  <span style={{ minWidth: 110 }}>Status</span>
                  <span style={{ minWidth: 70, textAlign: "right" }}>Due</span>
                  <span style={{ minWidth: 100, textAlign: "right" }}>Amount</span>
                  <span style={{ minWidth: 64 }}></span>
                </div>
                {items.map((b) => (
                  <BillRow key={b.id} bill={b} onClick={() => setSelected(b)} onSave={saveBillInline} />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <BillEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {selected && (
        <BillDetailPanel
          bill={selected}
          onClose={() => setSelected(null)}
          onPaid={() => { setSelected(null); load(); }}
          onEdit={() => { setEditing(selected); setSelected(null); }}
        />
      )}
    </>
  );
}

type CatBudget = {
  id: number; category: string; color: string | null; reimbursable?: boolean;
  budget: number | null; actual: number; remaining: number | null;
  pct: number | null; over: boolean;
};

// Everyday variable spending — gas, food, toiletries — planned per category.
// Planned amounts are the same `monthly_budget` the Analytics page edits;
// actuals come from this month's categorized bank imports.
function ExpensesTab() {
  const [rows, setRows] = useState<CatBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ budgets: CatBudget[] }>("/analytics/category-budgets?all=1");
      setRows(res.budgets);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveBudget(id: number) {
    const val = draft.trim() === "" ? null : Math.abs(Number(draft)) || 0;
    await api.put(`/categories/${id}`, { monthly_budget: val });
    setEditingId(null); setDraft("");
    load();
  }

  const planned = rows.reduce((s, r) => s + (r.budget || 0), 0);
  const spent = rows.reduce((s, r) => s + r.actual, 0);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <Eyebrow>Everyday spending</Eyebrow>
        <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
          · planned ${fmtMoney(planned)}/mo · spent ${fmtMoney(spent)} in {monthLabel}
        </span>
      </div>
      <Card padding={0} style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 130px 130px 130px 220px",
            alignItems: "center", gap: 16, padding: "12px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: 11, fontWeight: 600, color: "var(--fg-3)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}
        >
          <span>Category</span>
          <span style={{ textAlign: "right" }}>Planned / mo</span>
          <span style={{ textAlign: "right" }}>Spent</span>
          <span style={{ textAlign: "right" }}>Remaining</span>
          <span></span>
        </div>
        {rows.map((r) => {
          const editing = editingId === r.id;
          const pctCapped = r.pct != null ? Math.min(r.pct, 100) : null;
          return (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 130px 130px 130px 220px",
                alignItems: "center", gap: 16, padding: "12px 20px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 99, flexShrink: 0,
                  background: r.color || "var(--fg-3)",
                }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>{r.category}</span>
                {r.reimbursable && (
                  <span title="Deposits categorized here offset the spending — shows net out-of-pocket">
                    <Badge tone="neutral">reimbursable</Badge>
                  </span>
                )}
              </div>
              {editing ? (
                <Input
                  prefix="$" inputMode="decimal" value={draft} autoFocus
                  containerStyle={{ height: 32 }} style={{ textAlign: "right" }}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveBudget(r.id); if (e.key === "Escape") setEditingId(null); }}
                />
              ) : (
                <div
                  onClick={() => { setEditingId(r.id); setDraft(r.budget != null ? String(r.budget) : ""); }}
                  title="Click to set planned amount"
                  style={{ textAlign: "right", cursor: "pointer" }}
                >
                  {r.budget != null
                    ? <Amount value={r.budget} size="md" />
                    : <span style={{ fontSize: 13, color: "var(--fg-3)" }}>set…</span>}
                </div>
              )}
              <div style={{ textAlign: "right" }}><Amount value={r.actual} size="md" muted /></div>
              <div style={{
                textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13,
                color: r.remaining == null ? "var(--fg-3)" : r.remaining < 0 ? "var(--warning)" : "var(--fg-2)",
              }}>
                {r.remaining == null ? "—" : `${r.remaining < 0 ? "−" : ""}$${fmtMoney(Math.abs(r.remaining))}`}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {pctCapped != null ? (
                  <>
                    <div style={{ flex: 1, height: 6, borderRadius: 99, background: "var(--surface-inset)", overflow: "hidden" }}>
                      <div style={{
                        width: `${pctCapped}%`, height: "100%", borderRadius: 99,
                        background: r.over ? "var(--warning)" : "var(--success)",
                        transition: "width var(--dur-micro) var(--ease)",
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: r.over ? "var(--warning)" : "var(--fg-3)", minWidth: 40, textAlign: "right" }}>
                      {r.pct!.toFixed(0)}%
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--fg-3)" }}>no plan set</span>
                )}
                {editing && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => saveBudget(r.id)} icon="Check">{""}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} icon="X">{""}</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </Card>
      <p style={{ marginTop: 10, fontSize: 12, color: "var(--fg-3)" }}>
        Actuals come from this month's imported transactions. Categories are managed on the
        Analytics page; planned amounts set here feed the Debt payoff planner's "available extra" math.
      </p>
    </div>
  );
}

function BillRow({ bill, onClick, onSave }: { bill: Bill; onClick: () => void; onSave: (id: number, patch: any) => Promise<void> }) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const stop = (e: any) => e.stopPropagation();

  function start(e: any) {
    stop(e);
    setDraft({ amount: String(bill.amount), due_day: bill.due_day != null ? String(bill.due_day) : "", is_autopay: !!bill.is_autopay });
    setEditing(true);
  }
  async function commit(e: any) {
    stop(e);
    setBusy(true);
    try {
      await onSave(bill.id, {
        amount: Number(draft.amount) || 0,
        due_day: draft.due_day === "" ? null : Number(draft.due_day),
        is_autopay: !!draft.is_autopay,
      });
      setEditing(false);
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={editing ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto auto auto auto",
        alignItems: "center",
        gap: 16,
        padding: "12px 20px",
        borderBottom: "1px solid var(--border-subtle)",
        background: hover && !editing ? "var(--surface-2)" : "transparent",
        opacity: bill.status === "paid_off" ? 0.55 : 1,
        cursor: editing ? "default" : "pointer",
        transition: "background var(--dur-micro) var(--ease)",
      }}
    >
      <VendorIcon kind={bill.kind} size={36} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>{bill.name}</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
          {bill.is_autopay ? "Auto-pay" : "Manual"}
          {bill.credit_limit != null ? ` · limit $${fmtMoney(bill.credit_limit)}` : ""}
          {bill.balance_remaining ? ` · $${fmtMoney(bill.balance_remaining)} left` : ""}
          {bill.paid_off_on ? ` · paid off ${new Date(bill.paid_off_on + "T00:00:00").toLocaleDateString()}` : ""}
        </div>
      </div>
      {editing ? (
        <div onClick={stop} style={{ minWidth: 110, display: "flex", alignItems: "center", gap: 8 }}>
          <Switch on={!!draft.is_autopay} onChange={(v) => setDraft((d: any) => ({ ...d, is_autopay: v }))} />
          <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Auto-pay</span>
        </div>
      ) : (
        <div style={{ minWidth: 110, display: "flex", justifyContent: "flex-start" }}>
          <Badge tone={STATUS_TONE[bill.status]}>{STATUS_LABEL[bill.status]}</Badge>
        </div>
      )}
      {editing ? (
        <div onClick={stop} style={{ width: 76 }}>
          <Input value={draft.due_day} inputMode="numeric" placeholder="day" containerStyle={{ height: 32 }} style={{ textAlign: "right" }}
                 onChange={(e) => setDraft((d: any) => ({ ...d, due_day: e.target.value }))} />
        </div>
      ) : (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)", minWidth: 70, textAlign: "right" }}>
          {ordinalDay(bill.due_day)}
        </div>
      )}
      {editing ? (
        <div onClick={stop} style={{ width: 110 }}>
          <Input prefix="$" value={draft.amount} inputMode="decimal" containerStyle={{ height: 32 }} style={{ textAlign: "right" }}
                 onChange={(e) => setDraft((d: any) => ({ ...d, amount: e.target.value }))} />
        </div>
      ) : (
        <div style={{ minWidth: 100, textAlign: "right" }}>
          <Amount value={bill.amount} size="md" />
        </div>
      )}
      <div style={{ minWidth: 64, display: "flex", justifyContent: "flex-end", gap: 4 }}>
        {editing ? (
          <>
            <Button variant="ghost" size="sm" loading={busy} onClick={commit} icon="Check">{""}</Button>
            <Button variant="ghost" size="sm" onClick={(e) => { stop(e); setEditing(false); }} icon="X">{""}</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={start} icon="Pencil" title="Quick edit">{""}</Button>
        )}
      </div>
    </div>
  );
}
