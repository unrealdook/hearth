import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, Field, Input, Select, Badge,
} from "@/components/ui";

type Summary = {
  period: { from: string; to: string; months: number };
  income: {
    regular_projected: number;
    regular_monthly_rate: number;
    gross_projected: number;
    gross_monthly_rate: number;
    has_breakdown: boolean;
    deductions: {
      federal_tax: number;
      state_tax: number;
      fica: number;
      retirement_401k: number;
      health_insurance: number;
      other: number;
    };
    irregular_total: number;
    irregular_by_kind: Record<string, number>;
    total: number;
  };
  bills: { paid_in_period: number; paid_count: number };
  investments: {
    contributed_in_period: number;
    contributed_logged: number;
    contributed_via_paycheck: number;
    contributed_employer_match: number;
    by_kind: Record<string, number>;
    balance_now: number;
    balance_investment_accounts: number;
    balance_retirement: number;
  };
  give: {
    total_in_period: number;
    by_category: Record<string, number>;
    event_count: number;
  };
  snapshot: {
    savings: number; investments: number; retirement: number;
    debt: number; debt_backed_assets: number; net_worth: number;
  };
};

type Preset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year" | "custom";

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function rangeFor(preset: Preset, custom?: { from: string; to: string }): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this_month": {
      const from = new Date(y, m, 1);
      const to = now;
      return { from: toISO(from), to: toISO(to), label: from.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
    }
    case "last_month": {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0);
      return { from: toISO(from), to: toISO(to), label: from.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
    }
    case "this_quarter": {
      const q = Math.floor(m / 3);
      const from = new Date(y, q * 3, 1);
      return { from: toISO(from), to: toISO(now), label: `Q${q + 1} ${y}` };
    }
    case "last_quarter": {
      let q = Math.floor(m / 3) - 1;
      let qy = y;
      if (q < 0) { q = 3; qy = y - 1; }
      const from = new Date(qy, q * 3, 1);
      const to = new Date(qy, q * 3 + 3, 0);
      return { from: toISO(from), to: toISO(to), label: `Q${q + 1} ${qy}` };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: toISO(now), label: `${y} YTD` };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    case "custom":
      return { from: custom?.from || `${y}-01-01`, to: custom?.to || toISO(now), label: "Custom range" };
  }
}

export function Reports() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState<string>(`${new Date().getFullYear()}-01-01`);
  const [customTo, setCustomTo] = useState<string>(toISO(new Date()));
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => rangeFor(preset, { from: customFrom, to: customTo }), [preset, customFrom, customTo]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<Summary>(`/reports/summary?from=${range.from}&to=${range.to}`);
      setData(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [range.from, range.to]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Reports</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            For family meeting reviews. Showing <strong style={{ color: "var(--fg-1)" }}>{range.label}</strong> · {fmtDateLong(range.from)} → {fmtDateLong(range.to)}.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Period">
            <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} containerStyle={{ width: 180 }}>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="this_quarter">This quarter</option>
              <option value="last_quarter">Last quarter</option>
              <option value="this_year">This year (YTD)</option>
              <option value="last_year">Last year</option>
              <option value="custom">Custom range</option>
            </Select>
          </Field>
          {preset === "custom" && (
            <>
              <Field label="From">
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </Field>
            </>
          )}
          <Button variant="ghost" icon="RefreshCw" onClick={load} disabled={loading}>{""}</Button>
        </div>
      </div>

      {loading && !data && (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      )}

      {data && (
        <>
          {/* Top row — flows */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 16 }}>
            <FlowCard
              label="Income (total)"
              value={data.income.total}
              foot={`${data.period.months.toFixed(1)} months · regular + irregular`}
              tone="success"
            />
            <FlowCard
              label="Bills paid"
              value={data.bills.paid_in_period}
              foot={`${data.bills.paid_count} payments`}
              tone="neutral"
            />
            <FlowCard
              label="Invested"
              value={data.investments.contributed_in_period}
              foot={`${Object.keys(data.investments.by_kind).length} kinds`}
              tone="info"
            />
            <FlowCard
              label="Given"
              value={data.give.total_in_period}
              foot={`${data.give.event_count} gifts`}
              tone="warning"
            />
          </div>

          {/* Income detail */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Eyebrow>Income detail</Eyebrow>
              <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                ~ ${fmtMoney(data.income.has_breakdown ? data.income.gross_monthly_rate : data.income.regular_monthly_rate)} / mo {data.income.has_breakdown ? "gross" : ""}
              </div>
            </div>
            {data.income.has_breakdown ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
                  <SubLine label="Gross over period" value={data.income.gross_projected} bold />
                  <SubLine label="Take-home (net)" value={data.income.regular_projected} bold />
                  <SubLine label="Irregular bonuses etc." value={data.income.irregular_total} />
                </div>
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 8 }}>Where the gross went</div>
                  <BreakdownBars
                    rows={[
                      ["take_home", data.income.regular_projected],
                      ["federal_tax", data.income.deductions.federal_tax],
                      ["state_tax", data.income.deductions.state_tax],
                      ["fica", data.income.deductions.fica],
                      ["401k", data.income.deductions.retirement_401k],
                      ["health_insurance", data.income.deductions.health_insurance],
                      ...(data.income.deductions.other > 0 ? [["other_deductions", data.income.deductions.other] as [string, number]] : []),
                    ].filter(([, v]) => (v as number) > 0) as [string, number][]}
                    total={data.income.gross_projected}
                  />
                </div>
              </>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                <SubLine label="Regular (projected over period)" value={data.income.regular_projected} />
                <SubLine label="Irregular total" value={data.income.irregular_total} />
              </div>
            )}
            {Object.keys(data.income.irregular_by_kind).length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 8 }}>Irregular by kind</div>
                <BreakdownBars rows={Object.entries(data.income.irregular_by_kind)} total={data.income.irregular_total} />
              </div>
            )}
          </Card>

          <div style={{ height: 16 }} />

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
            {/* Investments */}
            <Card>
              <Eyebrow>Investments</Eyebrow>
              <div style={{ marginTop: 12 }}>
                <SubLine label="Contributed in period" value={data.investments.contributed_in_period} bold />
              </div>
              {data.investments.contributed_via_paycheck > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-3)" }}>
                  yours ${fmtMoney(data.investments.contributed_via_paycheck)}
                  {data.investments.contributed_employer_match > 0 && (
                    <> · employer match ${fmtMoney(data.investments.contributed_employer_match)}</>
                  )}
                  {data.investments.contributed_logged > 0 && (
                    <> · logged ${fmtMoney(data.investments.contributed_logged)}</>
                  )}
                </div>
              )}
              {Object.keys(data.investments.by_kind).length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                  <BreakdownBars
                    rows={Object.entries(data.investments.by_kind)}
                    total={data.investments.contributed_in_period}
                  />
                </div>
              )}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)",
                            display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-3)" }}>
                <span>current balance</span>
                <Amount value={data.investments.balance_now} size="sm" muted />
              </div>
            </Card>

            {/* Give */}
            <Card>
              <Eyebrow>Giving</Eyebrow>
              <div style={{ marginTop: 12 }}>
                <SubLine label="Given in period" value={data.give.total_in_period} bold />
              </div>
              {Object.keys(data.give.by_category).length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                  <BreakdownBars
                    rows={Object.entries(data.give.by_category)}
                    total={data.give.total_in_period}
                  />
                </div>
              )}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)",
                            display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-3)" }}>
                <span>events</span>
                <span>{data.give.event_count}</span>
              </div>
            </Card>
          </div>

          <div style={{ height: 16 }} />

          {/* Snapshot row */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Eyebrow>Snapshot (current)</Eyebrow>
              <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
                point-in-time balances — Hearth doesn't snapshot history yet
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 16 }}>
              <Card><Eyebrow>Cash</Eyebrow><div style={{ marginTop: 12 }}><Amount value={data.snapshot.savings} size="lg" /></div></Card>
              <Card><Eyebrow>Investments</Eyebrow><div style={{ marginTop: 12 }}><Amount value={data.snapshot.investments} size="lg" /></div></Card>
              <Card><Eyebrow>Retirement</Eyebrow><div style={{ marginTop: 12 }}><Amount value={data.snapshot.retirement} size="lg" /></div></Card>
              <Card><Eyebrow>Debt</Eyebrow><div style={{ marginTop: 12 }}><Amount value={-data.snapshot.debt} size="lg" /></div></Card>
              <Card style={{ background: "var(--surface-2)" } as any}>
                <Eyebrow>Net worth</Eyebrow>
                <div style={{ marginTop: 12 }}><Amount value={data.snapshot.net_worth} size="lg" /></div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function FlowCard({ label, value, foot, tone }: {
  label: string; value: number; foot: string; tone: "success" | "info" | "warning" | "neutral";
}) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow>{label}</Eyebrow>
        <Badge tone={tone}>{label.split(" ")[0]}</Badge>
      </div>
      <div style={{ marginTop: 12 }}><Amount value={value} size="lg" /></div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{foot}</div>
    </Card>
  );
}

function SubLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 4 }}>{label}</div>
      <Amount value={value} size={bold ? "lg" : "md"} />
    </div>
  );
}

function BreakdownBars({ rows, total }: { rows: [string, number][]; total: number }) {
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sorted.map(([k, v]) => {
        const pct = total > 0 ? (v / total) * 100 : 0;
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 110, fontSize: 12, color: "var(--fg-2)", textTransform: "capitalize" }}>
              {k.replace(/_/g, " ")}
            </div>
            <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand)" }} />
            </div>
            <div style={{ width: 90, textAlign: "right" }}><Amount value={v} size="sm" /></div>
          </div>
        );
      })}
    </div>
  );
}
