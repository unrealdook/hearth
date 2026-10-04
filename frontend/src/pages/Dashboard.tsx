import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney, fmtMonthDay } from "@/lib/format";
import { Card, Eyebrow, Amount, Button, Badge, VendorIcon, Spinner, EmptyState, Select } from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";
import { Link } from "react-router-dom";
import { ApiError } from "@/lib/api";

type AnalyticsSummary = {
  month: number; year: number;
  total_monthly_bills: number;
  paid_this_month: number;
  paid_count: number;
  unpaid_count: number;
  remaining_this_month: number;
  cash: number; investments: number; retirement: number;
  debt_total: number; asset_total: number; networth: number;
  bill_count: number;
};

type Upcoming = {
  id: number; name: string; category: string; kind: string; amount: number;
  due_date_iso: string; days_until_due: number;
  status: "due" | "sched" | "overdue"; is_autopay: boolean;
};

type Alert = {
  severity: "danger" | "warning" | "info";
  category: string; title: string; detail: string; route: string;
};

type ReportSummary = {
  period: { from: string; to: string; months: number };
  income: {
    regular_projected: number; regular_monthly_rate: number;
    gross_projected: number; gross_monthly_rate: number;
    has_breakdown: boolean;
    irregular_total: number; total: number;
  };
  bills: { paid_in_period: number; paid_count: number };
  investments: {
    contributed_in_period: number;
    contributed_logged: number;
    contributed_via_paycheck: number;
    balance_now: number;
  };
  give: { total_in_period: number; event_count: number };
};

type Budget = {
  id: number; source: string;
  live_pct: number; invest_pct: number; save_pct: number; debt_pct: number; give_pct: number;
};

type Goals = {
  givePct: number;
  investPct: number;
  annualTakeHome: number;
  give: { goal: number; actual: number; expected: number };
  invest: { goal: number; actual: number; expected: number };
};

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function Dashboard() {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [mtd, setMtd] = useState<ReportSummary | null>(null);
  const [ytd, setYtd] = useState<ReportSummary | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const now = new Date();
    const firstOfMonth = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const firstOfYear = `${now.getFullYear()}-01-01`;
    const today = toISO(now);
    try {
      const [a, u, m, y, b] = await Promise.all([
        api.get<AnalyticsSummary>("/analytics/summary"),
        api.get<Upcoming[]>("/analytics/upcoming"),
        api.get<ReportSummary>(`/reports/summary?from=${firstOfMonth}&to=${today}`),
        api.get<ReportSummary>(`/reports/summary?from=${firstOfYear}&to=${today}`),
        api.get<Budget[]>("/budget"),
      ]);
      setAnalytics(a); setUpcoming(u); setMtd(m); setYtd(y); setBudgets(b);
    } finally { setLoading(false); }
    // Alerts load independently so a hiccup here never blocks the dashboard.
    api.get<{ alerts: Alert[] }>("/analytics/alerts")
      .then((r) => setAlerts(r.alerts)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function markPaid(b: Upcoming) {
    const r = await api.post<any>("/payments", { bill_id: b.id, paid: true, amount_paid: b.amount });
    if (r?.pay_from && r.pay_from.new_balance < 0) {
      alert(`Heads up: paying ${b.name} put ${r.pay_from.account_name} at $${fmtMoney(r.pay_from.new_balance)}. Move money in to cover it.`);
    }
    load();
  }

  // Goals: derive annual targets from budget percentages × annual take-home
  const goals = useMemo(() => {
    if (!ytd) return null;
    // annual take-home = regular_monthly_rate × 12 (from YTD report's income block)
    const annualTakeHome = ytd.income.regular_monthly_rate * 12;
    const givePct = budgets.reduce((m, b) => Math.max(m, b.give_pct || 0), 0);
    const investPct = budgets.reduce((m, b) => Math.max(m, b.invest_pct || 0), 0);
    const giveGoal = (givePct / 100) * annualTakeHome;
    const investGoal = (investPct / 100) * annualTakeHome;
    const givenYtd = ytd.give.total_in_period;
    const investedYtd = ytd.investments.contributed_in_period;
    // Expected pace by today: fraction-of-year × annual goal
    const start = new Date(new Date().getFullYear(), 0, 1);
    const fraction = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 365);
    return {
      givePct, investPct, annualTakeHome,
      give: { goal: giveGoal, actual: givenYtd, expected: giveGoal * fraction },
      invest: { goal: investGoal, actual: investedYtd, expected: investGoal * fraction },
    };
  }, [ytd, budgets]);

  const topSignal = useMemo(() => {
    if (!goals) return null;
    // Pick the biggest "behind" or "ahead" signal worth showing
    const candidates: { label: string; tone: "success" | "warning" | "danger" | "info"; detail: string }[] = [];
    if (goals.give.goal > 0) {
      const diff = goals.give.actual - goals.give.expected;
      if (diff < -goals.give.goal * 0.05) {
        candidates.push({
          label: `Behind on giving by $${fmtMoney(-diff)}`,
          tone: "warning",
          detail: `Pace would have you at $${fmtMoney(goals.give.expected)} by today; you're at $${fmtMoney(goals.give.actual)}.`,
        });
      } else if (diff > goals.give.goal * 0.05) {
        candidates.push({
          label: `Ahead on giving by $${fmtMoney(diff)}`,
          tone: "success",
          detail: `You're ahead of pace toward your $${fmtMoney(goals.give.goal)} annual goal.`,
        });
      }
    }
    if (goals.invest.goal > 0) {
      const diff = goals.invest.actual - goals.invest.expected;
      if (diff < -goals.invest.goal * 0.05) {
        candidates.push({
          label: `Behind on investing by $${fmtMoney(-diff)}`,
          tone: "warning",
          detail: `Annual target is $${fmtMoney(goals.invest.goal)}; you're at $${fmtMoney(goals.invest.actual)}.`,
        });
      } else if (diff > goals.invest.goal * 0.05) {
        candidates.push({
          label: `Ahead on investing by $${fmtMoney(diff)}`,
          tone: "success",
          detail: `Auto + logged contributions are running ahead of pace.`,
        });
      }
    }
    if (candidates.length === 0 && (goals.give.goal > 0 || goals.invest.goal > 0)) {
      return { label: "On pace with your goals", tone: "success" as const, detail: "Giving and investing are tracking near plan." };
    }
    // Pick the most-extreme one
    return candidates.sort((a, b) => (a.tone === "warning" ? -1 : 1))[0] ?? null;
  }, [goals]);

  if (loading || !analytics || !mtd || !ytd) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner size={24} /></div>;
  }

  const next = upcoming[0];
  // Show everything overdue or due within ~10 days; if nothing's close,
  // fall back to the next few. Cap so the card stays readable.
  const dueSoon = upcoming.filter((b) => b.status === "overdue" || b.days_until_due <= 10);
  const shownBills = (dueSoon.length > 0 ? dueSoon : upcoming.slice(0, 4)).slice(0, 8);
  const shownTotal = shownBills.reduce((s, b) => s + (b.amount || 0), 0);
  const overdueCount = upcoming.filter((b) => b.status === "overdue").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 className="t-h2" style={{ margin: 0 }}>{greet()}</h1>
        <p style={{ marginTop: 4, color: "var(--fg-2)", fontSize: 15 }}>
          {analytics.unpaid_count > 0
            ? `You've got ${analytics.unpaid_count} bill${analytics.unpaid_count === 1 ? "" : "s"} still to pay this month.`
            : "Everything's paid for this month. Nice."}
        </p>
      </div>

      {/* Top zone — alerts on the left; the goal signal + month recap stacked on
          the right, so three short cards share two columns instead of stacking. */}
      {(alerts.length > 0 || topSignal) ? (
        <div style={{ display: "grid", gridTemplateColumns: alerts.length > 0 ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr", gap: 16, alignItems: "start" }}>
          {alerts.length > 0 && <NeedsAttentionCard alerts={alerts} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {topSignal && <SignalCard signal={topSignal} />}
            <DigestCard />
          </div>
        </div>
      ) : (
        <DigestCard />
      )}

      {/* Hero row — bills + goals side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <BillsHero analytics={analytics} next={next ?? null} />
        <GoalsHero goals={goals} />
      </div>

      {/* MTD scorecards */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <Eyebrow>This month</Eyebrow>
          <Link to="/reports" style={{ textDecoration: "none" }}>
            <Button variant="ghost" size="sm" iconAfter="ArrowUpRight">Full reports</Button>
          </Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
          <ScorecardCard label="Income" value={mtd.income.total} subtitle={mtd.income.irregular_total > 0 ? `incl. $${fmtMoney(mtd.income.irregular_total)} irregular` : "regular pay"} />
          <ScorecardCard label="Bills paid" value={mtd.bills.paid_in_period} subtitle={`${mtd.bills.paid_count} payments`} />
          <ScorecardCard label="Given" value={mtd.give.total_in_period} subtitle={`${mtd.give.event_count} ${mtd.give.event_count === 1 ? "gift" : "gifts"}`} />
          <ScorecardCard label="Invested" value={mtd.investments.contributed_in_period}
            subtitle={mtd.investments.contributed_via_paycheck > 0 ? `incl. paycheck 401(k)` : "logged deposits"} />
        </div>
      </div>

      {/* Detail row */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
        <Card padding={0}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "18px 24px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>Upcoming bills</div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500, color: "var(--fg-2)", fontFeatureSettings: '"tnum" 1' }}>
                  <Private strength={7}>· ${fmtMoney(shownTotal)}</Private>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
                {overdueCount > 0
                  ? `${overdueCount} overdue · ${shownBills.length} shown · what's due soon`
                  : `${shownBills.length} bill${shownBills.length === 1 ? "" : "s"} due soon`}
              </div>
            </div>
            <Link to="/bills" style={{ textDecoration: "none" }}>
              <Button variant="ghost" size="sm" iconAfter="ArrowUpRight">View all</Button>
            </Link>
          </div>
          {shownBills.length === 0 ? (
            <EmptyState title="No bills coming up." body="Add one to start tracking." icon="Receipt" />
          ) : (
            shownBills.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "14px 24px",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <VendorIcon kind={b.kind} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
                    {fmtMonthDay(b.due_date_iso)}
                    {b.is_autopay ? " · Auto-pay" : ""}
                  </div>
                </div>
                <Badge tone={b.status === "overdue" ? "overdue" : b.days_until_due <= 3 ? "due" : "sched"}>
                  {b.status === "overdue"
                    ? `Overdue by ${Math.abs(b.days_until_due)}d`
                    : b.days_until_due === 0
                    ? "Due today"
                    : `Due in ${b.days_until_due}d`}
                </Badge>
                <Amount value={b.amount} size="md" />
                {!b.is_autopay && (
                  <Button variant="primary" size="sm" onClick={() => markPaid(b)}>Pay</Button>
                )}
              </div>
            ))
          )}
        </Card>

        <Card padding={0}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>Net worth</div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>Across everything</div>
          </div>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <Amount value={analytics.networth} size="xl" />
            <NetWorthRow label="Cash" value={analytics.cash} />
            <NetWorthRow label="Investments" value={analytics.investments} />
            <NetWorthRow label="Retirement" value={analytics.retirement} />
            <NetWorthRow label="Asset value" value={analytics.asset_total} />
            <NetWorthRow label="Debts" value={-analytics.debt_total} negative />
          </div>
        </Card>
      </div>
    </div>
  );
}

function NeedsAttentionCard({ alerts }: { alerts: Alert[] }) {
  return (
    <Card padding={0}>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-subtle)",
                    display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>Needs attention</div>
        <Badge tone="neutral">{alerts.length}</Badge>
      </div>
      {alerts.map((al, i) => (
        <Link
          key={i}
          to={al.route}
          style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "14px 24px", textDecoration: "none",
            borderBottom: i < alerts.length - 1 ? "1px solid var(--border-subtle)" : "none",
          }}
        >
          <span style={{
            marginTop: 6, width: 8, height: 8, borderRadius: 99, flexShrink: 0,
            background: al.severity === "danger" ? "var(--danger)"
                      : al.severity === "warning" ? "var(--warning)" : "var(--info)",
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>{al.title}</div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>{al.detail}</div>
          </div>
          <Badge tone={al.severity === "danger" ? "overdue" : al.severity === "warning" ? "warning" : "info"}>
            {al.category}
          </Badge>
        </Link>
      ))}
    </Card>
  );
}

function SignalCard({ signal }: { signal: { label: string; tone: "success" | "warning" | "danger" | "info"; detail: string } }) {
  return (
    <Card style={{
      borderColor: signal.tone === "warning" ? "var(--warning)"
                 : signal.tone === "danger" ? "var(--danger)"
                 : signal.tone === "success" ? "var(--success)"
                 : "var(--info)",
    } as any}>
      <Badge tone={signal.tone}>{signal.tone === "warning" ? "Heads up" : signal.tone === "success" ? "On track" : "Note"}</Badge>
      <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>{signal.label}</div>
      <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg-3)" }}>{signal.detail}</div>
    </Card>
  );
}

function BillsHero({ analytics, next }: { analytics: AnalyticsSummary; next: Upcoming | null }) {
  return (
    <Card style={{ position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: -80, right: -80, width: 320, height: 320,
        background: "radial-gradient(circle, rgba(58,95,184,0.12), transparent 60%)",
        pointerEvents: "none",
      }} />
      <Eyebrow>Due this month</Eyebrow>
      <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 12 }}>
        <Private>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 48, fontWeight: 500,
            letterSpacing: "-0.03em", color: "var(--fg-1)",
            fontFeatureSettings: '"tnum" 1',
          }}>
            <span style={{ color: "var(--fg-3)", fontSize: 32, marginRight: 6 }}>$</span>
            {fmtMoney(analytics.remaining_this_month)}
          </span>
        </Private>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: "var(--fg-2)" }}>
        across {analytics.unpaid_count} bills · {analytics.paid_count} already paid
      </div>
      {next && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12,
        }}>
          <div>
            <div style={{ color: "var(--fg-3)" }}>Next up</div>
            <div style={{ color: "var(--fg-1)", marginTop: 2 }}>
              {next.name} · {next.days_until_due <= 0 ? "Due today" : `${next.days_until_due}d`}
            </div>
          </div>
          <Amount value={next.amount} size="sm" muted />
        </div>
      )}
    </Card>
  );
}

function GoalsHero({ goals }: { goals: Goals | null }) {
  if (!goals) return null;
  const hasAny = goals.give.goal > 0 || goals.invest.goal > 0;
  return (
    <Card>
      <Eyebrow>Goals · year to date</Eyebrow>
      {!hasAny ? (
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--fg-3)" }}>
          Set Give % and Invest % in your budget allocation on the Income page to track progress here.
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 18 }}>
          {goals.give.goal > 0 && (
            <GoalRow label="Giving" pct={goals.givePct} goal={goals.give.goal}
                     actual={goals.give.actual} expected={goals.give.expected} />
          )}
          {goals.invest.goal > 0 && (
            <GoalRow label="Investing" pct={goals.investPct} goal={goals.invest.goal}
                     actual={goals.invest.actual} expected={goals.invest.expected} />
          )}
        </div>
      )}
    </Card>
  );
}

function GoalRow({ label, pct, goal, actual, expected }: {
  label: string; pct: number; goal: number; actual: number; expected: number;
}) {
  const progress = goal > 0 ? Math.min(100, (actual / goal) * 100) : 0;
  const expectedMarker = goal > 0 ? Math.min(100, (expected / goal) * 100) : 0;
  const onPace = actual >= expected - goal * 0.05;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "var(--fg-1)", fontWeight: 500 }}>{label}</span>
        <span style={{ color: "var(--fg-3)" }}>
          <Private strength={6}>${fmtMoney(actual)}</Private> / <Private strength={6}>${fmtMoney(goal)}</Private>
          <span style={{ marginLeft: 6, fontSize: 11 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{
        height: 8, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden", position: "relative",
      }}>
        <div style={{
          width: `${progress}%`, height: "100%",
          background: onPace ? "var(--success)" : "var(--brand)",
          transition: "width var(--dur-state) var(--ease)",
        }} />
        {/* expected-pace tick mark */}
        <div style={{
          position: "absolute", top: -2, bottom: -2,
          left: `${expectedMarker}%`, width: 2, background: "var(--fg-3)",
          opacity: 0.6,
        }} title={`Pace mark: $${fmtMoney(expected)}`} />
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-3)", display: "flex", justifyContent: "space-between" }}>
        <span>{progress.toFixed(0)}% of annual goal</span>
        <span style={{ color: onPace ? "var(--success)" : "var(--warning)" }}>
          {onPace ? "on/ahead of pace" : `behind pace by $${fmtMoney(expected - actual)}`}
        </span>
      </div>
    </div>
  );
}

function ScorecardCard({ label, value, subtitle }: { label: string; value: number; subtitle: string }) {
  return (
    <Card>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 12 }}><Amount value={value} size="lg" /></div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{subtitle}</div>
    </Card>
  );
}

function NetWorthRow({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{label}</span>
      <Amount value={value} size="sm" muted={!negative} />
    </div>
  );
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return "You're up late.";
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

function DigestCard() {
  const now = new Date();
  const periods = useMemo(() => {
    const out: { value: string; label: string; month: number; year: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        value: `${d.getFullYear()}-${d.getMonth() + 1}`,
        label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        month: d.getMonth() + 1, year: d.getFullYear(),
      });
    }
    return out;
  }, []);
  const [sel, setSel] = useState(periods[0].value);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const p = periods.find((x) => x.value === sel)!;
    setBusy(true); setError(null); setText(null);
    try {
      const r = await api.post<{ digest: string }>("/ai/digest", { month: p.month, year: p.year });
      setText(r.digest);
    } catch (e) {
      setError(e instanceof ApiError ? (e.payload?.message || e.message) : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    padding: "16px 24px", borderBottom: text || error ? "1px solid var(--border-subtle)" : "none" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>Month in review</div>
          <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>A plain-English recap, written on your machine.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ minWidth: 150 }}>
            <Select value={sel} onChange={(e) => setSel(e.target.value)}>
              {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
          <Button variant="primary" size="md" icon="Sparkles" onClick={generate} loading={busy}>Write it</Button>
        </div>
      </div>
      {error && <div style={{ padding: "14px 24px", fontSize: 13, color: "var(--danger)" }}>{error}</div>}
      {text && (
        <div style={{ padding: "18px 24px", fontSize: 14, lineHeight: 1.6, color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>
          {text}
        </div>
      )}
    </Card>
  );
}
