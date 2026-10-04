import { useEffect, useState } from "react";
import { Maximize2, ChevronLeft } from "lucide-react";
import { CategorySelect, type Category } from "@/components/categories/CategoryTools";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend, Area, AreaChart, ReferenceDot,
} from "recharts";
import { api } from "@/lib/api";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Card, Eyebrow, Spinner, EmptyState, Amount, Badge, Segmented, Modal, Button } from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";

// outflow_source: "transactions" = real spending from imports, "bills" = the
// paid-bills fallback for a month that hasn't been imported yet.
type Cashflow = { month: number; income: number; outflow: number; outflow_source?: "transactions" | "bills" };
type Spending = { category: string; total: number; color?: string | null };
type Merchant = { merchant: string; total: number; count: number; category: string };
type YoyRow = { year: number; total: number };

type Subscription = {
  merchant: string; key: string; amount: number; monthly_cost: number;
  cadence: string; count: number; last_seen: string; active: boolean;
  is_bill: boolean; bill_id: number | null; bill_name: string | null;
};
type SubsResp = {
  subscriptions: Subscription[]; active_count: number; bill_count: number;
  total_monthly: number; total_annual: number;
};

/** Recurring charges with no bill behind them. Steady ones come with a
 *  ready-made bill; `variable` ones (Apple, Google) bill different amounts
 *  every time and can't honestly become a single bill. */
type Untracked = {
  merchant: string; key: string; amount: number; monthly_cost: number;
  cadence: string; count: number; last_seen: string; category: string | null;
  suggested_bill: { name: string; amount: number; category: string; due_day: number;
                    is_autopay: boolean; kind: string };
};
type VariableCharge = {
  merchant: string; key: string; count: number; total: number; monthly_avg: number;
  smallest: number; largest: number; category: string | null; last_seen: string;
};
type UntrackedResp = {
  subscriptions: Untracked[]; count: number; monthly_total: number; annual_total: number;
  variable: VariableCharge[]; variable_monthly_total: number;
};

type RunwayMonth = { year: number; month: number; income: number; outflow: number; net: number };
type Runway = {
  months: RunwayMonth[]; cash: number; avg_net: number | null; burn?: number;
  runway_months: number | null; negative_months: number; total_months?: number;
  worst?: RunwayMonth | null; basis: string;
};
type Forecast = {
  days: number; start_balance: number; end_balance: number;
  low_balance: number; low_date: string; monthly_income_estimate: number;
  series: { date: string; balance: number }[];
};
type NWPoint = {
  year: number; month: number; net_worth: number;
  cash: number; investments: number; retirement: number; asset_value: number; debt: number;
};
type NWProjection = {
  current_net_worth: number; months: number; monthly_change: number; projected_net_worth: number;
  savings_basis: string; applied_monthly_savings: number;
  drivers: {
    monthly_income: number; monthly_bills: number; monthly_savings: number;
    monthly_retirement_contrib: number; monthly_change: number;
    retirement_growth_pct: number; investment_growth_pct: number; blended_growth_pct: number;
  };
};

const PALETTE = [
  "var(--ember-400)", "var(--ember-300)", "var(--success)", "var(--warning)",
  "var(--info)", "#8E7FE0", "#5BB99F", "#E07F8E", "#7FA8E0", "#A8E07F",
];

const sliceColor = (e: Spending, i: number) => e.color || PALETTE[i % PALETTE.length];

/** The spending donut, shared by the card and the expanded popup. */
function SpendingDonut({ data, height, inner = 60, outer = 100, showLegend = true, onSliceClick }: {
  data: Spending[]; height: number; inner?: number; outer?: number; showLegend?: boolean;
  onSliceClick?: (category: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="category" innerRadius={inner} outerRadius={outer} paddingAngle={2}
          style={{ cursor: onSliceClick ? "pointer" : "default", outline: "none" }}
          onClick={onSliceClick ? (d: any) => onSliceClick(d?.category ?? d?.payload?.category) : undefined}>
          {data.map((e, i) => <Cell key={i} fill={sliceColor(e, i)} />)}
        </Pie>
        <Tooltip
          contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
          itemStyle={{ color: "var(--fg-1)" }}
          labelStyle={{ color: "var(--fg-2)" }}
          formatter={(v: number, name: string) => [`$${fmtMoney(v)}`, name]}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 11, color: "var(--fg-2)" }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

/** In-popup list of a category's or merchant's transactions, each
 * inline-recategorizable, with a "set all to…" bulk action. */
function DrillView({ drill, txns, categories, onRecat, onBulk }: {
  drill: { type: "category" | "merchant"; value: string };
  txns: any[] | null; categories: Category[];
  onRecat: (tx: any, newCat: string) => void;
  onBulk: (newCat: string) => void;
}) {
  const [bulkCat, setBulkCat] = useState("");
  if (txns === null) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner /></div>;
  }
  const total = txns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drill.value}</div>
          <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{drill.type === "merchant" ? "merchant" : "category"}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
          {txns.length} transaction{txns.length === 1 ? "" : "s"} · <Private strength={8}>${fmtMoney(total)}</Private>
        </div>
      </div>
      {txns.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", background: "var(--surface-inset)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)" }}>
          <span style={{ fontSize: 12, color: "var(--fg-2)", whiteSpace: "nowrap" }}>Set all {txns.length} to</span>
          <div style={{ width: 180 }}>
            <CategorySelect value={bulkCat} categories={categories} onChange={setBulkCat} height={32} />
          </div>
          <button disabled={!bulkCat} onClick={() => bulkCat && onBulk(bulkCat)}
            style={{ background: bulkCat ? "var(--brand)" : "var(--surface-3)", color: bulkCat ? "#fff" : "var(--fg-4)", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: bulkCat ? "pointer" : "default" }}>
            Apply
          </button>
        </div>
      )}
      {txns.length === 0 ? (
        <EmptyState title="No transactions here." icon="Inbox" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 420, overflowY: "auto" }}>
          {txns.map((t) => (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "84px minmax(0,1fr) 150px 92px", gap: 10, alignItems: "center", padding: "8px 4px", borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>
              <span style={{ color: "var(--fg-3)", fontSize: 12 }}>{fmtDate(t.date)}</span>
              <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>{t.description}</span>
              <CategorySelect value={t.category || ""} categories={categories} onChange={(v) => onRecat(t, v)} />
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: t.amount < 0 ? "var(--fg-1)" : "var(--success)" }}>
                <Private strength={8}>{t.amount < 0 ? "-" : "+"}${fmtMoney(Math.abs(t.amount))}</Private>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Analytics() {
  const [cashflow, setCashflow] = useState<Cashflow[] | null>(null);
  const [spending, setSpending] = useState<Spending[] | null>(null);
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [spendMonths, setSpendMonths] = useState("6");  // "3" | "6" | "12" | "all"
  const [pieOpen, setPieOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [drill, setDrill] = useState<{ type: "category" | "merchant"; value: string } | null>(null);
  const [drillTxns, setDrillTxns] = useState<any[] | null>(null);
  const [budgets, setBudgets] = useState<Record<string, any>>({});
  const [yoy, setYoy] = useState<YoyRow[] | null>(null);
  const [networth, setNetworth] = useState<any>(null);
  const [subs, setSubs] = useState<SubsResp | null>(null);
  const [untracked, setUntracked] = useState<UntrackedResp | null>(null);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [addedBills, setAddedBills] = useState<Set<string>>(new Set());
  const [subFilter, setSubFilter] = useState<"all" | "not_bill" | "bill">("all");
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [nwHistory, setNwHistory] = useState<NWPoint[] | null>(null);
  const [nwProj, setNwProj] = useState<NWProjection | null>(null);
  const [loading, setLoading] = useState(true);

  function loadSpending(win: string) {
    const sp = windowParams(win);
    const spq = sp.toString();
    api.get<Spending[]>(`/analytics/spending${spq ? `?${spq}` : ""}`).then(setSpending).catch(() => {});
    const mp = windowParams(win); mp.set("limit", "12");
    api.get<Merchant[]>(`/analytics/spending-merchants?${mp}`).then(setMerchants).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      api.get<Cashflow[]>("/analytics/cashflow"),
      api.get<YoyRow[]>("/analytics/yoy"),
      api.get("/analytics/networth"),
    ]).then(([c, y, n]) => {
      setCashflow(c); setYoy(y); setNetworth(n);
    }).finally(() => setLoading(false));
    api.get<SubsResp>("/analytics/subscriptions").then(setSubs).catch(() => {});
    api.get<UntrackedResp>("/analytics/untracked-subscriptions").then(setUntracked).catch(() => {});
    api.get<Runway>("/analytics/runway").then(setRunway).catch(() => {});
    api.get<Forecast>("/analytics/forecast?days=45").then(setForecast).catch(() => {});
    api.get<NWPoint[]>("/analytics/networth-history").then(setNwHistory).catch(() => {});
    api.get<NWProjection>("/analytics/networth-projection?months=12").then(setNwProj).catch(() => {});
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    loadBudgets();
  }, []);

  function loadBudgets() {
    api.get<{ budgets: any[] }>("/analytics/category-budgets")
      .then((r) => {
        const m: Record<string, any> = {};
        (r.budgets || []).forEach((b) => { m[b.category] = b; });
        setBudgets(m);
      }).catch(() => {});
  }

  useEffect(() => {
    loadSpending(spendMonths);
    if (drill) loadDrill(drill, spendMonths);
  }, [spendMonths]);

  function loadDrill(f: { type: "category" | "merchant"; value: string }, win: string) {
    setDrillTxns(null);
    const params = windowParams(win);
    params.set(f.type, f.value);
    params.set("limit", "2000");
    api.get<any[]>(`/import/transactions?${params}`).then(setDrillTxns).catch(() => setDrillTxns([]));
  }
  function openCategory(cat: string) { if (cat) { setPieOpen(true); setDrill({ type: "category", value: cat }); loadDrill({ type: "category", value: cat }, spendMonths); } }
  function openMerchant(name: string) { if (name) { setPieOpen(true); setDrill({ type: "merchant", value: name }); loadDrill({ type: "merchant", value: name }, spendMonths); } }
  function closeDrill() { setDrill(null); setDrillTxns(null); loadSpending(spendMonths); }

  async function recatDrill(tx: any, newCat: string) {
    setDrillTxns((prev) => prev ? prev.map((x) => (x.id === tx.id ? { ...x, category: newCat } : x)) : prev);
    try { await api.put(`/import/transactions/${tx.id}`, { category: newCat }); } catch {}
  }

  async function bulkRecat(newCat: string) {
    const ids = (drillTxns || []).map((t) => t.id);
    if (!ids.length || !drill) return;
    if (!confirm(`Set all ${ids.length} transactions to "${newCat}"?`)) return;
    try {
      await api.post("/import/transactions/bulk-categorize", { ids, category: newCat });
      loadDrill(drill, spendMonths);
    } catch {}
  }

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>;

  const cashflowFmt = (cashflow || []).map((c) => ({
    month: monthLabel(c.month) + (c.outflow_source === "bills" ? "*" : ""),
    income: c.income,
    outflow: c.outflow,
  }));
  // Months still on the bills-only fallback get a footnote rather than silently
  // showing a much smaller outflow bar than their neighbours.
  const estimatedMonths = (cashflow || [])
    .filter((c) => c.outflow_source === "bills")
    .map((c) => monthLabel(c.month));

  const hiddenCats = new Set(categories.filter((c) => c.chart_hidden).map((c) => c.name));
  const visibleSpending = (spending || []).filter((r) => !hiddenCats.has(r.category));
  const pieTotal = visibleSpending.reduce((s, r) => s + r.total, 0);

  async function toggleCategoryVisible(name: string, visible: boolean) {
    const cat = categories.find((c) => c.name === name);
    if (!cat) return;  // e.g. "Uncategorized" has no category row
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, chart_hidden: !visible } : c)));
    try { await api.put(`/categories/${cat.id}`, { chart_hidden: !visible }); } catch {}
  }

  async function setBudget(name: string, raw: string) {
    const cat = categories.find((c) => c.name === name);
    if (!cat) return;
    const t = raw.trim();
    const val = t === "" ? null : Math.max(0, parseFloat(t) || 0);
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, monthly_budget: val } : c)));
    try { await api.put(`/categories/${cat.id}`, { monthly_budget: val }); loadBudgets(); } catch {}
  }

  // Net worth over time. The 12-month projection comes from the backend, which
  // drives it off income − bills (+ 401k) instead of extrapolating the snapshot
  // slope — so it reflects what you actually earn and spend, not a two-point dip.
  const nwData = (nwHistory || []).map((p) => ({
    label: `${monthLabel(p.month)} '${String(p.year).slice(2)}`,
    net_worth: p.net_worth,
  }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 className="t-h2" style={{ margin: 0 }}>Analytics</h1>
        <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
          How money's moving.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        <Card><Eyebrow>Cash</Eyebrow><div style={{ marginTop: 10 }}><Amount value={networth?.cash} size="lg" /></div></Card>
        <Card><Eyebrow>Investments</Eyebrow><div style={{ marginTop: 10 }}><Amount value={networth?.investments} size="lg" /></div></Card>
        <Card><Eyebrow>Retirement</Eyebrow><div style={{ marginTop: 10 }}><Amount value={networth?.retirement} size="lg" /></div></Card>
        <Card>
          <Eyebrow>Net worth</Eyebrow>
          <div style={{ marginTop: 10 }}><Amount value={networth?.total} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            incl. <Private strength={6}>${fmtMoney(networth?.asset_total || 0)}</Private> assets − <Private strength={6}>${fmtMoney(networth?.debt_total || 0)}</Private> debt
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Net worth over time</Eyebrow>
          {nwProj && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                Projected ~<span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>${fmtMoney(nwProj.projected_net_worth)}</span> in 12 months
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
                {nwProj.monthly_change >= 0 ? "+" : "−"}
                <span style={{ fontFamily: "var(--font-mono)" }}>${fmtMoney(Math.abs(nwProj.monthly_change))}</span>/mo · 401k contributions
                {nwProj.drivers.blended_growth_pct > 0 ? ` + ~${nwProj.drivers.blended_growth_pct}%/yr growth` : ""}
                {nwProj.savings_basis === "break_even" ? " · cash break-even" : ""}
              </div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, height: 260 }}>
          {nwData.length < 2 ? (
            <EmptyState
              title={nwData.length === 1 ? "First snapshot captured." : "Tracking starts now."}
              body="A net-worth point is saved each month you open the app — the line fills in as months pass."
              icon="TrendingUp"
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={nwData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`$${fmtMoney(v)}`, "Net worth"]} />
                <Area type="monotone" dataKey="net_worth" stroke="var(--success)" strokeWidth={2} fill="url(#nwFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginBottom: 24 }}>
        <Card>
          <Eyebrow>Monthly cashflow</Eyebrow>
          <div style={{ marginTop: 12, height: 280 }}>
            {cashflowFmt.length === 0 ? (
              <EmptyState title="Nothing to chart yet." body="Log some income and mark a few bills paid." icon="BarChart3" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashflowFmt} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--fg-2)" }} />
                  <Bar dataKey="income"  fill="var(--success)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outflow" fill="var(--brand)"   radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--fg-3)" }}>
            Outflow is real spending, minus transfers between your own accounts.
            {estimatedMonths.length > 0 && (
              <> {estimatedMonths.join(", ")} marked * {estimatedMonths.length === 1 ? "has" : "have"}
              {" "}no imported transactions yet, so {estimatedMonths.length === 1 ? "it shows" : "they show"} paid bills only.</>
            )}
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Eyebrow>Spending by category</Eyebrow>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Segmented
                options={SPEND_WINDOWS}
                value={spendMonths}
                onChange={setSpendMonths}
              />
              <button
                title="Expand"
                onClick={() => setPieOpen(true)}
                disabled={!spending || spending.length === 0}
                style={{ display: "flex", alignItems: "center", background: "none", border: "1px solid var(--border-default)", borderRadius: 8, padding: 6, color: "var(--fg-2)", cursor: "pointer" }}
              >
                <Maximize2 size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <div style={{ marginTop: 12, height: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(!spending || spending.length === 0) ? (
              <EmptyState title="No spending data yet." body="Import a bank statement to see breakdowns." icon="PieChart" />
            ) : (
              <SpendingDonut data={visibleSpending} height={280} />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <Eyebrow>Top merchants · {windowLabel(spendMonths)}</Eyebrow>
        <div style={{ marginTop: 12 }}>
          {(!merchants || merchants.length === 0) ? (
            <EmptyState title="No merchant data yet." body="Import a bank statement to see where your money goes." icon="Store" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {merchants.map((m, i) => {
                const max = merchants[0].total || 1;
                return (
                  <button key={i} onClick={() => openMerchant(m.merchant)} title="See this merchant's transactions"
                    style={{ display: "grid", gridTemplateColumns: "1fr 90px 110px", gap: 12, alignItems: "center", padding: "8px 4px", borderBottom: i < merchants.length - 1 ? "1px solid var(--border-subtle)" : "none", background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.merchant}</div>
                      <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "var(--surface-3)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(3, (m.total / max) * 100)}%`, height: "100%", background: "var(--brand)" }} />
                      </div>
                    </div>
                    <Badge tone="neutral">{m.category || "—"}</Badge>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)" }}>
                      <Private strength={8}>${fmtMoney(m.total)}</Private>
                      <span style={{ color: "var(--fg-4)", fontSize: 11 }}> ·{m.count}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <Eyebrow>Year over year</Eyebrow>
        <div style={{ marginTop: 12, height: 220 }}>
          {(!yoy || yoy.length === 0) ? (
            <EmptyState title="Not enough history yet." body="Once you've got a year or two of payments logged, this will fill in." icon="TrendingUp" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yoy} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `$${fmtMoney(v)}`} />
                <Line type="monotone" dataKey="total" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3, fill: "var(--brand)" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Cash-flow forecast */}
      <Card style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Cash-flow forecast · next {forecast?.days ?? 45} days</Eyebrow>
          {forecast && (
            <div style={{ fontSize: 12, color: forecast.low_balance < 0 ? "var(--danger)" : "var(--fg-3)" }}>
              Projected low: <span style={{ fontFamily: "var(--font-mono)" }}>${fmtMoney(forecast.low_balance)}</span>
              {" "}on {fmtDate(forecast.low_date)}
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, height: 260 }}>
          {!forecast || forecast.series.length < 2 ? (
            <EmptyState title="Not enough to forecast yet." body="Add bills with due days and some income to project your balance." icon="TrendingUp" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false}
                       tickFormatter={(v) => fmtDate(v)} minTickGap={40} />
                <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                         labelFormatter={(v) => fmtDate(String(v))} formatter={(v: number) => `$${fmtMoney(v)}`} />
                <Area type="monotone" dataKey="balance" stroke="var(--brand)" strokeWidth={2} fill="url(#balFill)" />
                <ReferenceDot x={forecast.low_date} y={forecast.low_balance} r={4}
                              fill={forecast.low_balance < 0 ? "var(--danger)" : "var(--warning)"} stroke="none" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        {forecast && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-3)" }}>
            Starting ${fmtMoney(forecast.start_balance)} · est. income ${fmtMoney(forecast.monthly_income_estimate)}/mo ·
            projected end ${fmtMoney(forecast.end_balance)}
          </div>
        )}
      </Card>

      {/* Savings runway */}
      {runway && runway.months.length > 0 && (() => {
        const burning = (runway.avg_net ?? 0) < 0;
        return (
          <Card style={{ marginTop: 24, borderColor: burning ? "var(--warning)" : undefined }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div>
                <Eyebrow>Savings runway</Eyebrow>
                <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 28,
                                 color: burning ? "var(--warning)" : "var(--success)" }}>
                    {burning
                      ? (runway.runway_months != null ? `${runway.runway_months} mo` : "—")
                      : `+$${fmtMoney(runway.avg_net ?? 0)}/mo`}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--fg-3)" }}>
                    {burning
                      ? `of cover at $${fmtMoney(runway.burn ?? 0)}/mo burn`
                      : "average surplus"}
                  </span>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-3)" }}>
                  ${fmtMoney(runway.cash)} personal cash ·{" "}
                  {runway.negative_months} of {runway.total_months} closed months negative
                  {runway.worst && (
                    <> · worst was {monthLabel(runway.worst.month)} at −${fmtMoney(Math.abs(runway.worst.net))}</>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 64 }}>
                {runway.months.map((m) => {
                  const peak = Math.max(...runway.months.map((x) => Math.abs(x.net)), 1);
                  const h = Math.max(4, (Math.abs(m.net) / peak) * 56);
                  return (
                    <div key={`${m.year}-${m.month}`} title={`${monthLabel(m.month)}: ${m.net < 0 ? "−" : "+"}$${fmtMoney(Math.abs(m.net))}`}
                         style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 20, height: h, borderRadius: 3,
                                    background: m.net < 0 ? "var(--danger)" : "var(--success)" }} />
                      <span style={{ fontSize: 10, color: "var(--fg-4)" }}>{monthLabel(m.month)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--fg-4)" }}>
              Closed months with imported spending only — a partly-imported month would look like a surplus.
              Business accounts excluded.
            </div>
          </Card>
        );
      })()}

      {/* Recurring charges with no bill behind them */}
      {untracked && (untracked.count > 0 || untracked.variable.length > 0) && (
        <Card style={{ marginTop: 24 }}>
          <Eyebrow>Not tracked as bills</Eyebrow>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            Recurring charges with no bill behind them —{" "}
            ${fmtMoney(untracked.monthly_total + untracked.variable_monthly_total)}/mo in total.
          </div>

          {untracked.subscriptions.filter((s) => !addedBills.has(s.key)).length > 0 && (
            <div style={{ marginTop: 16 }}>
              {untracked.subscriptions.filter((s) => !addedBills.has(s.key)).map((s) => (
                <div key={s.key} style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 150px",
                                          gap: 12, alignItems: "center", padding: "10px 0",
                                          borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--fg-1)" }}>{s.suggested_bill.name}</div>
                    <div style={{ fontSize: 11, color: "var(--fg-4)", overflow: "hidden",
                                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.merchant}</div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)", textAlign: "right" }}>
                    ${fmtMoney(s.amount)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{s.cadence} · {s.count}x</div>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <Button variant="secondary" size="sm"
                            onClick={async () => {
                              await api.post("/bills", s.suggested_bill);
                              setAddedBills((p) => new Set(p).add(s.key));
                            }}>Add as bill</Button>
                    <Button variant="ghost" size="sm"
                            onClick={() => setAddedBills((p) => new Set(p).add(s.key))}>Ignore</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {untracked.variable.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-2)" }}>
                Charges that vary — ${fmtMoney(untracked.variable_monthly_total)}/mo
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 2, marginBottom: 8 }}>
                Several subscriptions bundled under one merchant, so there's no single amount to bill.
                Worth knowing the running cost.
              </div>
              {untracked.variable.map((v) => (
                <div key={v.key} style={{ display: "grid", gridTemplateColumns: "1fr 120px 160px",
                                          gap: 12, alignItems: "center", padding: "8px 0",
                                          borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 13, color: "var(--fg-1)" }}>{v.merchant}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)", textAlign: "right" }}>
                    ${fmtMoney(v.monthly_avg)}<span style={{ fontSize: 11, color: "var(--fg-3)" }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fg-3)", textAlign: "right" }}>
                    {v.count} charges · ${fmtMoney(v.smallest)}–${fmtMoney(v.largest)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Detected subscriptions */}
      <Card padding={0} style={{ marginTop: 24 }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-subtle)",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>Recurring charges</div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
              Detected from imported transactions{subs && subs.bill_count > 0 ? ` · ${subs.bill_count} match a bill` : ""}
            </div>
          </div>
          {subs && subs.active_count > 0 && (
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--fg-2)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--fg-1)" }}>
                ${fmtMoney(subs.total_monthly)}<span style={{ fontSize: 12, color: "var(--fg-3)" }}>/mo</span>
              </div>
              <div>${fmtMoney(subs.total_annual)}/yr across {subs.active_count}</div>
            </div>
          )}
        </div>
        {subs && subs.subscriptions.length > 0 && (
          <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border-subtle)" }}>
            <Segmented
              value={subFilter}
              onChange={(v) => setSubFilter(v as typeof subFilter)}
              options={[
                { label: "All", value: "all" },
                { label: "Not a bill", value: "not_bill" },
                { label: "Bills", value: "bill" },
              ]}
            />
          </div>
        )}
        {!subs || subs.subscriptions.length === 0 ? (
          <EmptyState title="No recurring charges spotted." body="Import a few months of bank statements and we'll flag subscriptions." icon="Repeat" />
        ) : (() => {
          const rows = subs.subscriptions.filter((s) =>
            subFilter === "all" ? true : subFilter === "bill" ? s.is_bill : !s.is_bill);
          if (rows.length === 0) {
            return <EmptyState title={subFilter === "bill" ? "No charges matched a bill." : "No anomalous charges."} body={subFilter === "not_bill" ? "Every recurring charge lines up with a bill you track." : "Try a different filter."} icon="Repeat" />;
          }
          return rows.map((s) => (
            <div key={s.key} style={{
              display: "grid", gridTemplateColumns: "1fr 110px 90px 130px",
              gap: 12, alignItems: "center", padding: "12px 24px",
              borderBottom: "1px solid var(--border-subtle)", fontSize: 13,
              opacity: s.active ? 1 : 0.55,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.merchant}
                  </span>
                  {s.is_bill && (
                    <span style={{ flexShrink: 0 }} title={s.bill_name ? `Matches bill: ${s.bill_name}` : "Matches a tracked bill"}>
                      <Badge tone="info">Bill</Badge>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
                  {s.count}× · last {fmtDate(s.last_seen)}{!s.active ? " · inactive" : ""}
                </div>
              </div>
              <Badge tone="neutral">{s.cadence}</Badge>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)", textAlign: "right" }}>
                ${fmtMoney(s.amount)}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)", textAlign: "right" }}>
                ${fmtMoney(s.monthly_cost)}/mo
              </span>
            </div>
          ));
        })()}
      </Card>

      <Modal open={pieOpen} onClose={() => { setPieOpen(false); closeDrill(); }} title="Spending by category"
        subtitle={windowLabel(spendMonths)} width={940}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          {drill ? (
            <button onClick={closeDrill} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer", fontSize: 13, padding: 0 }}>
              <ChevronLeft size={16} /> Back to chart
            </button>
          ) : <span style={{ fontSize: 12, color: "var(--fg-4)" }}>Click a category to see its transactions</span>}
          <Segmented options={SPEND_WINDOWS} value={spendMonths} onChange={setSpendMonths} />
        </div>

        {drill ? (
          <DrillView drill={drill} txns={drillTxns} categories={categories} onRecat={recatDrill} onBulk={bulkRecat} />
        ) : (!spending || spending.length === 0) ? (
          <EmptyState title="No spending data yet." body="Import a bank statement to see breakdowns." icon="PieChart" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 24, alignItems: "center" }}>
            <SpendingDonut data={visibleSpending} height={400} inner={90} outer={150} showLegend={false} onSliceClick={openCategory} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 420, overflowY: "auto" }}>
              <div style={{ fontSize: 11, color: "var(--fg-4)", padding: "0 4px 6px" }}>Uncheck to exclude · set a monthly budget below (bar = this month)</div>
              {spending.map((r, i) => {
                const cat = categories.find((c) => c.name === r.category);
                const hidden = !!cat?.chart_hidden;
                const b = budgets[r.category];
                const hasBudget = cat?.monthly_budget != null;
                return (
                  <div key={i} style={{ borderBottom: "1px solid var(--border-subtle)", opacity: hidden ? 0.45 : 1, padding: "6px 4px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "18px 12px 1fr auto", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={!hidden} disabled={!cat}
                        title={cat ? "Show in chart" : "Uncategorized — can't hide"}
                        onChange={(e) => toggleCategoryVisible(r.category, e.target.checked)}
                        style={{ cursor: cat ? "pointer" : "default" }} />
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: sliceColor(r, i) }} />
                      <button onClick={() => openCategory(r.category)} title="See transactions"
                        style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 13, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.category}
                      </button>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)" }}>
                        <Private strength={8}>${fmtMoney(r.total)}</Private>
                        {!hidden && <span style={{ color: "var(--fg-4)", fontSize: 11 }}> · {pieTotal ? Math.round((r.total / pieTotal) * 100) : 0}%</span>}
                      </span>
                    </div>
                    {cat && !hidden && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, paddingLeft: 26 }}>
                        <span style={{ fontSize: 11, color: "var(--fg-4)" }}>$</span>
                        <input type="number" min="0" defaultValue={cat.monthly_budget ?? ""} placeholder="budget"
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          onBlur={(e) => setBudget(r.category, e.target.value)}
                          style={{ width: 88, fontSize: 12, padding: "3px 8px", background: "var(--surface-inset)", border: "1px solid var(--border-default)", borderRadius: 6, color: "var(--fg-1)" }} />
                        <span style={{ fontSize: 11, color: "var(--fg-4)" }}>/mo</span>
                        {hasBudget && b && (
                          <>
                            <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--surface-3)", overflow: "hidden" }}
                              title={`$${fmtMoney(b.actual)} of $${fmtMoney(b.budget)} this month`}>
                              <div style={{ width: `${Math.min(100, b.pct || 0)}%`, height: "100%", background: b.over ? "var(--danger)" : ((b.pct || 0) >= 80 ? "var(--warning)" : "var(--success)") }} />
                            </div>
                            <span style={{ fontSize: 11, color: b.over ? "var(--danger)" : "var(--fg-3)", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{Math.round(b.pct || 0)}%</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "18px 12px 1fr auto", gap: 8, alignItems: "center", padding: "8px 4px 0", fontWeight: 600 }}>
                <span /><span />
                <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Total shown</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)" }}>
                  <Private strength={8}>${fmtMoney(pieTotal)}</Private>
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function monthLabel(m: number) {
  return new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

/** Spending window options for the pie + drill filters. */
const SPEND_WINDOWS = [
  { label: "This mo", value: "tm" },
  { label: "Last mo", value: "lm" },
  { label: "3M", value: "3" },
  { label: "6M", value: "6" },
  { label: "12M", value: "12" },
  { label: "All", value: "all" },
];

/** Turn a window value into query params: "all" → none, "tm"/"lm" → a calendar
 * month's start/end, numeric N → trailing months=N. */
function windowParams(win: string): URLSearchParams {
  const p = new URLSearchParams();
  if (win === "all") return p;
  if (win === "tm" || win === "lm") {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() - (win === "lm" ? 1 : 0), 1);
    const y = base.getFullYear(), m = base.getMonth();
    const mm = String(m + 1).padStart(2, "0");
    const lastDay = new Date(y, m + 1, 0).getDate();
    p.set("start", `${y}-${mm}-01`);
    p.set("end", `${y}-${mm}-${String(lastDay).padStart(2, "0")}`);
  } else {
    p.set("months", win);
  }
  return p;
}

function windowLabel(win: string): string {
  if (win === "all") return "All time";
  if (win === "tm") return "This month";
  if (win === "lm") return "Last month";
  return `Last ${win} months`;
}
