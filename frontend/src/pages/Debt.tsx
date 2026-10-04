import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, EmptyState, Modal, Field, Input, Select, Badge,
} from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";

type Debt = {
  id: number; name: string; debt_amount: number; asset_value: number;
  interest_rate: number; monthly_payment: number; category: string;
  group_name: string | null; notes: string | null; updated_at: string | null;
};

// A row in the table: either a standalone debt or a bundle of debts sharing a
// group_name (e.g. one borrower's pile of student loans).
type Row =
  | { kind: "single"; debt: Debt }
  | { kind: "group"; name: string; items: Debt[] };

type PayoffPlan = {
  months: number; total_interest: number; payoff_date: string | null;
  schedule: { name: string; months: number }[];
};
type Payoff = {
  total_balance: number; total_min_payment: number; extra: number;
  avalanche: PayoffPlan; snowball: PayoffPlan;
  interest_saved_vs_snowball: number;
  budget?: {
    monthly_income: number; monthly_bills: number; after_bills: number;
    planned_expenses: number; after_expenses: number;
    planned_save: number; planned_invest: number; planned_give: number;
    available_extra: number;
  };
};

const CATEGORIES = [
  { value: "mortgage",   label: "Mortgage" },
  { value: "auto",       label: "Auto" },
  { value: "student",    label: "Student" },
  { value: "credit_card",label: "Credit card" },
  { value: "personal",   label: "Personal" },
  { value: "other",      label: "Other" },
];

export function Debt() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Debt> | null>(null);
  const [payoff, setPayoff] = useState<Payoff | null>(null);
  const [extra, setExtra] = useState("0");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [busyInline, setBusyInline] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  function toggleGroup(name: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function startEdit(d: Debt) { setEditingId(d.id); setDraft({ ...d }); }
  function cancelEdit() { setEditingId(null); setDraft({}); }
  async function commitEdit() {
    setBusyInline(true);
    try { await save(draft); setEditingId(null); setDraft({}); }
    finally { setBusyInline(false); }
  }
  const setD = (k: string, v: any) => setDraft((p: any) => ({ ...p, [k]: v }));

  async function load() {
    setLoading(true);
    try {
      setDebts(await api.get<Debt[]>("/debt"));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const n = Number(extra) || 0;
    const t = setTimeout(() => {
      api.get<Payoff>(`/analytics/debt-payoff?extra=${n}`).then(setPayoff).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [extra, debts]);

  const totals = useMemo(() => {
    const debt = debts.reduce((s, d) => s + (d.debt_amount || 0), 0);
    const asset = debts.reduce((s, d) => s + (d.asset_value || 0), 0);
    const monthly = debts.reduce((s, d) => s + (d.monthly_payment || 0), 0);
    return { debt, asset, monthly, net: asset - debt };
  }, [debts]);

  // Collapse same-group debts into one row, keeping the API's category/name
  // order (a group sits where its first member appears).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const d of debts) {
      const g = (d.group_name || "").trim();
      if (!g) { out.push({ kind: "single", debt: d }); continue; }
      if (seen.has(g)) continue;
      seen.add(g);
      out.push({ kind: "group", name: g, items: debts.filter((x) => (x.group_name || "").trim() === g) });
    }
    return out;
  }, [debts]);

  const groupNames = useMemo(
    () => [...new Set(debts.map((d) => (d.group_name || "").trim()).filter(Boolean))],
    [debts],
  );

  type SortKey = "name" | "balance" | "rate" | "payment";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  // asc → desc → back to default (category/name from the API); numeric columns
  // start descending (biggest first), name starts ascending.
  function toggleSort(key: SortKey) {
    setSort((s) => {
      const first: 1 | -1 = key === "name" ? 1 : -1;
      if (!s || s.key !== key) return { key, dir: first };
      return s.dir === first ? { key, dir: (-first) as 1 | -1 } : null;
    });
  }

  const debtVal = (d: Debt, k: SortKey): string | number =>
    k === "name" ? d.name.toLowerCase()
    : k === "balance" ? (d.debt_amount || 0)
    : k === "rate" ? (d.interest_rate || 0)
    : (d.monthly_payment || 0);

  // A group sorts by its aggregates: summed balance/payment, weighted-avg rate.
  const rowVal = (r: Row, k: SortKey): string | number => {
    if (r.kind === "single") return debtVal(r.debt, k);
    if (k === "name") return r.name.toLowerCase();
    const bal = r.items.reduce((s, d) => s + (d.debt_amount || 0), 0);
    if (k === "balance") return bal;
    if (k === "payment") return r.items.reduce((s, d) => s + (d.monthly_payment || 0), 0);
    return bal > 0 ? r.items.reduce((s, d) => s + (d.debt_amount || 0) * (d.interest_rate || 0), 0) / bal : 0;
  };

  const cmp = (va: string | number, vb: string | number, dir: 1 | -1) =>
    (va < vb ? -1 : va > vb ? 1 : 0) * dir;

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => cmp(rowVal(a, sort.key), rowVal(b, sort.key), sort.dir));
  }, [rows, sort]);

  const sortHeader = (label: string, key: SortKey, right = false) => (
    <span
      onClick={() => toggleSort(key)}
      title={`Sort by ${label.toLowerCase()}`}
      style={{ textAlign: right ? "right" : "left", cursor: "pointer", userSelect: "none" }}
    >
      {label}
      {sort?.key === key && (
        <span style={{ color: "var(--brand)" }}>{sort.dir === 1 ? " ↑" : " ↓"}</span>
      )}
    </span>
  );

  async function save(form: Partial<Debt>) {
    const payload: any = { ...form };
    for (const k of ["debt_amount", "asset_value", "interest_rate", "monthly_payment"]) {
      if (payload[k] !== undefined && payload[k] !== "") payload[k] = Number(payload[k]) || 0;
    }
    if (typeof payload.group_name === "string") payload.group_name = payload.group_name.trim() || null;
    if (form.id) await api.put(`/debt/${form.id}`, payload);
    else await api.post("/debt", payload);
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this debt entry?")) return;
    await api.del(`/debt/${id}`);
    load();
  }

  // One debt line. `child` rows live inside an expanded group: indented, and
  // the "no backing asset" nag is suppressed (a bundle of student loans is
  // expected to be unbacked — flagging each one is noise).
  // A loan at $0 is done; strike it through. Credit cards are revolving — a $0
  // balance is normal, not a payoff — so they're exempt.
  const isPaidOff = (d: Debt) => (d.debt_amount || 0) <= 0 && d.category !== "credit_card";

  function renderDebtRow(d: Debt, child: boolean) {
    const paidOff = isPaidOff(d);
    const unbacked = !child && !paidOff && (d.asset_value || 0) <= 0 && d.debt_amount > 0;
    const editing = editingId === d.id;
    return (
      <div
        key={d.id}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 130px 130px 110px 130px 110px 60px",
          gap: 16,
          alignItems: "center",
          padding: child ? "10px 20px 10px 44px" : "14px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          background: child ? "var(--surface-inset)" : undefined,
          opacity: paidOff && !editing ? 0.55 : 1,
        }}
      >
        {editing ? (
          <Input value={draft.name ?? ""} containerStyle={{ height: 34 }} onChange={(e) => setD("name", e.target.value)} />
        ) : (
          <div>
            <div style={{ fontSize: child ? 13 : 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={paidOff ? { textDecoration: "line-through", color: "var(--fg-3)" } : undefined}>
                {d.name}
              </span>
              {paidOff && <Badge tone="success">Paid off</Badge>}
              {unbacked && (
                <span title="No backing asset" style={{ color: "var(--warning)", display: "inline-flex" }}>
                  <AlertTriangle size={14} strokeWidth={2} />
                </span>
              )}
            </div>
            {d.notes && <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{d.notes}</div>}
            {d.updated_at && (
              <div style={{ fontSize: 11, color: "var(--fg-3)", opacity: 0.8 }}>
                Balance synced {fmtDate(d.updated_at)}
              </div>
            )}
          </div>
        )}
        {editing ? (
          <Select value={draft.category} containerStyle={{ height: 34 }} onChange={(e) => setD("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        ) : child ? (
          <span />
        ) : (
          <Badge tone="neutral">{CATEGORIES.find((c) => c.value === d.category)?.label || d.category}</Badge>
        )}
        {editing ? (
          <Input prefix="$" inputMode="decimal" value={draft.debt_amount ?? ""} containerStyle={{ height: 34 }} style={{ textAlign: "right" }} onChange={(e) => setD("debt_amount", e.target.value)} />
        ) : (
          <div style={{ textAlign: "right" }}><Amount value={d.debt_amount} size={child ? "sm" : "md"} /></div>
        )}
        {editing ? (
          <Input inputMode="decimal" value={draft.interest_rate ?? ""} containerStyle={{ height: 34 }} style={{ textAlign: "right" }} onChange={(e) => setD("interest_rate", e.target.value)} />
        ) : (
          <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-2)" }}>
            <Private strength={8}>{(d.interest_rate || 0).toFixed(2)}%</Private>
          </div>
        )}
        {editing ? (
          <Input prefix="$" inputMode="decimal" value={draft.asset_value ?? ""} containerStyle={{ height: 34 }} style={{ textAlign: "right" }} onChange={(e) => setD("asset_value", e.target.value)} />
        ) : (
          <div style={{ textAlign: "right" }}><Amount value={d.asset_value} size={child ? "sm" : "md"} muted /></div>
        )}
        {editing ? (
          <Input prefix="$" inputMode="decimal" value={draft.monthly_payment ?? ""} containerStyle={{ height: 34 }} style={{ textAlign: "right" }} onChange={(e) => setD("monthly_payment", e.target.value)} />
        ) : (
          <div style={{ textAlign: "right" }}><Amount value={d.monthly_payment} size="sm" muted /></div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
          {editing ? (
            <>
              <Button variant="ghost" size="sm" loading={busyInline} onClick={commitEdit} icon="Check">{""}</Button>
              <Button variant="ghost" size="sm" onClick={cancelEdit} icon="X">{""}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => startEdit(d)} icon="Pencil">{""}</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(d.id)} icon="Trash2">{""}</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Debt</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>What you owe and what backs it.</p>
        </div>
        <Button icon="Plus" onClick={() => setEditing({ category: "other" })}>Add debt</Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        <Card>
          <Eyebrow>Total debt</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.debt} size="xl" /></div>
        </Card>
        <Card>
          <Eyebrow>Asset value</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.asset} size="xl" /></div>
        </Card>
        <Card>
          <Eyebrow>Net (assets – debt)</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.net} size="xl" /></div>
        </Card>
        <Card>
          <Eyebrow>Monthly payments</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.monthly} size="xl" /></div>
        </Card>
      </div>

      {payoff && payoff.total_balance > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <div>
              <Eyebrow>Payoff planner</Eyebrow>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 4 }}>
                Minimums total ${fmtMoney(payoff.total_min_payment)}/mo. Add extra to compare strategies.
                As each debt is paid off, its payment rolls into the next one — total outlay stays
                constant until you're debt-free (that's why even the mortgage finishes early).
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Extra/mo</span>
              <div style={{ width: 130 }}>
                <Input prefix="$" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
              </div>
            </div>
          </div>
          {payoff.budget && payoff.budget.monthly_income > 0 && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "10px 14px", marginBottom: 16,
                background: "var(--surface-inset)", borderRadius: "var(--r-md)",
                fontSize: 13, color: "var(--fg-2)",
              }}
            >
              <BudgetStep label="Take-home" value={payoff.budget.monthly_income} />
              <Arrow />
              <BudgetStep label="After bills" value={payoff.budget.after_bills} />
              {payoff.budget.planned_expenses > 0 && (
                <>
                  <Arrow />
                  <BudgetStep
                    label="After expenses"
                    value={payoff.budget.after_expenses}
                    hint={`−$${fmtMoney(payoff.budget.planned_expenses)} planned everyday spending (Bills → Expenses)`}
                  />
                </>
              )}
              <Arrow />
              <BudgetStep
                label="After save / invest / give"
                value={payoff.budget.available_extra}
                hint={`−$${fmtMoney(payoff.budget.planned_save)} save · −$${fmtMoney(payoff.budget.planned_invest)} invest · −$${fmtMoney(payoff.budget.planned_give)} give`}
                strong
              />
              {payoff.budget.available_extra > 0 && Number(extra) !== Math.floor(payoff.budget.available_extra) && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setExtra(String(Math.floor(payoff.budget!.available_extra)))}
                >
                  Use as extra
                </Button>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <PayoffCard
              title="Avalanche"
              subtitle="Highest interest rate first — least interest paid"
              plan={payoff.avalanche}
              highlight={payoff.interest_saved_vs_snowball >= 0}
            />
            <PayoffCard
              title="Snowball"
              subtitle="Smallest balance first — fastest wins"
              plan={payoff.snowball}
              highlight={payoff.interest_saved_vs_snowball < 0}
            />
          </div>
          {payoff.interest_saved_vs_snowball !== 0 && (
            <div style={{ marginTop: 14, fontSize: 13, color: "var(--fg-2)" }}>
              {payoff.interest_saved_vs_snowball > 0
                ? <>Avalanche saves <strong style={{ color: "var(--success)" }}>${fmtMoney(payoff.interest_saved_vs_snowball)}</strong> in interest vs snowball.</>
                : <>Snowball costs <strong style={{ color: "var(--warning)" }}>${fmtMoney(-payoff.interest_saved_vs_snowball)}</strong> more in interest, but pays off a debt sooner for momentum.</>}
            </div>
          )}
        </Card>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : debts.length === 0 ? (
        <Card>
          <EmptyState title="No debt tracked yet." body="Mortgages, auto loans, student loans, credit cards — log each so we can see net worth and projections." icon="Banknote"
            action={<Button icon="Plus" onClick={() => setEditing({ category: "other" })}>Add debt</Button>} />
        </Card>
      ) : (
        <Card padding={0}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 130px 130px 110px 130px 110px 60px",
              gap: 16,
              padding: "12px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: 11, fontWeight: 600, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em",
            }}
          >
            {sortHeader("Name", "name")}
            <span>Category</span>
            {sortHeader("Balance", "balance", true)}
            {sortHeader("Rate", "rate", true)}
            <span style={{ textAlign: "right" }}>Asset value</span>
            {sortHeader("Mo. payment", "payment", true)}
            <span></span>
          </div>
          {sortedRows.map((row) => {
            if (row.kind === "single") return renderDebtRow(row.debt, false);
            const open = openGroups.has(row.name);
            const items = sort
              ? [...row.items].sort((a, b) => cmp(debtVal(a, sort.key), debtVal(b, sort.key), sort.dir))
              : row.items;
            const bal = row.items.reduce((s, d) => s + (d.debt_amount || 0), 0);
            const asset = row.items.reduce((s, d) => s + (d.asset_value || 0), 0);
            const monthly = row.items.reduce((s, d) => s + (d.monthly_payment || 0), 0);
            const wavg = bal > 0
              ? row.items.reduce((s, d) => s + (d.debt_amount || 0) * (d.interest_rate || 0), 0) / bal
              : 0;
            const cat = row.items[0]?.category;
            return (
              <div key={`group:${row.name}`}>
                <div
                  onClick={() => toggleGroup(row.name)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 130px 130px 110px 130px 110px 60px",
                    gap: 16,
                    alignItems: "center",
                    padding: "14px 20px",
                    borderBottom: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-flex", color: "var(--fg-3)" }}>
                        {open ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
                      </span>
                      <span style={{
                        fontSize: 14, fontWeight: 600,
                        ...(row.items.every(isPaidOff) ? { textDecoration: "line-through", color: "var(--fg-3)" } : {}),
                      }}>{row.name}</span>
                      <Badge tone="neutral">{row.items.length} loans</Badge>
                      {row.items.some(isPaidOff) && (
                        <Badge tone="success">
                          {row.items.every(isPaidOff)
                            ? "Paid off"
                            : `${row.items.filter(isPaidOff).length} of ${row.items.length} paid`}
                        </Badge>
                      )}
                    </div>
                    {(() => {
                      const latest = row.items.reduce<string | null>(
                        (m, d) => (d.updated_at && (!m || d.updated_at > m) ? d.updated_at : m), null);
                      return latest ? (
                        <div style={{ fontSize: 11, color: "var(--fg-3)", opacity: 0.8, marginLeft: 24 }}>
                          Balance synced {fmtDate(latest)}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <Badge tone="neutral">{CATEGORIES.find((c) => c.value === cat)?.label || cat}</Badge>
                  <div style={{ textAlign: "right" }}><Amount value={bal} size="md" /></div>
                  <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-2)" }}>
                    <Private strength={8}>{wavg.toFixed(2)}%</Private>
                    <div style={{ fontSize: 10, color: "var(--fg-3)" }}>wtd avg</div>
                  </div>
                  <div style={{ textAlign: "right" }}><Amount value={asset} size="md" muted /></div>
                  <div style={{ textAlign: "right" }}><Amount value={monthly} size="sm" muted /></div>
                  <div />
                </div>
                {open && items.map((d) => renderDebtRow(d, true))}
              </div>
            );
          })}
        </Card>
      )}

      {editing && (
        <DebtEditor initial={editing} groupNames={groupNames} onClose={() => setEditing(null)} onSave={save} />
      )}
    </>
  );
}

function PayoffCard({ title, subtitle, plan, highlight }: {
  title: string; subtitle: string; plan: PayoffPlan; highlight?: boolean;
}) {
  const capped = plan.months >= 1200;
  const years = Math.floor(plan.months / 12);
  const rem = plan.months % 12;
  const durationLabel = capped
    ? "Never (payments don't cover interest)"
    : `${years > 0 ? `${years}y ` : ""}${rem}mo`;
  return (
    <div style={{
      padding: 20, borderRadius: "var(--r-lg)",
      background: "var(--surface-inset)",
      border: `1px solid ${highlight ? "var(--success)" : "var(--border-subtle)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{title}</span>
        {highlight && <Badge tone="success">Recommended</Badge>}
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>{subtitle}</div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <Row label="Debt-free in" value={durationLabel} />
        <Row label="Payoff date" value={capped ? "—" : fmtDate(plan.payoff_date)} />
        <Row label="Total interest" value={`$${fmtMoney(plan.total_interest)}`} />
      </div>
      {plan.schedule.length > 0 && !capped && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Order paid off
          </div>
          {plan.schedule.map((s, i) => (
            <div key={s.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
              <span style={{ color: "var(--fg-2)" }}>{i + 1}. {s.name}</span>
              <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>mo {s.months}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetStep({ label, value, hint, strong }: {
  label: string; value: number; hint?: string; strong?: boolean;
}) {
  const negative = value < 0;
  return (
    <div title={hint}>
      <div style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontWeight: strong ? 600 : 500,
        color: negative ? "var(--warning)" : strong ? "var(--success)" : "var(--fg-1)",
      }}>
        {negative ? "−" : ""}${fmtMoney(Math.abs(value))}/mo
      </div>
    </div>
  );
}

function Arrow() {
  return <span style={{ color: "var(--fg-3)" }}>→</span>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 13, color: "var(--fg-3)" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
}

function DebtEditor({ initial, groupNames, onClose, onSave }: {
  initial: Partial<Debt>; groupNames: string[]; onClose: () => void; onSave: (d: any) => void;
}) {
  const [form, setForm] = useState<any>({ ...initial });
  return (
    <Modal
      open onClose={onClose}
      title={initial.id ? "Edit debt" : "Add debt"}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => onSave(form)}>Save</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name">
          <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Home mortgage" />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Category" style={{ flex: 1 }}>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Interest rate %" style={{ flex: 1 }}>
            <Input value={form.interest_rate ?? ""} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Balance owed" style={{ flex: 1 }}>
            <Input prefix="$" value={form.debt_amount ?? ""} onChange={(e) => setForm({ ...form, debt_amount: e.target.value })} />
          </Field>
          <Field label="Asset value" style={{ flex: 1 }}>
            <Input prefix="$" value={form.asset_value ?? ""} onChange={(e) => setForm({ ...form, asset_value: e.target.value })} />
          </Field>
        </div>
        <Field label="Monthly payment">
          <Input prefix="$" value={form.monthly_payment ?? ""} onChange={(e) => setForm({ ...form, monthly_payment: e.target.value })} />
        </Field>
        <Field label="Group (optional — bundles loans into one row, e.g. one borrower's student loans)">
          <Input
            list="debt-group-names"
            value={form.group_name ?? ""}
            onChange={(e) => setForm({ ...form, group_name: e.target.value })}
            placeholder="e.g. Dept of Ed loans"
          />
          <datalist id="debt-group-names">
            {groupNames.map((g) => <option key={g} value={g} />)}
          </datalist>
        </Field>
        <Field label="Notes">
          <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
