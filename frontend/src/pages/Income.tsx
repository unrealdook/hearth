import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, EmptyState, Modal, Field, Input, Textarea, Select, Badge, Segmented,
} from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";

type Income = {
  id: number; source: string; amount: number; frequency: string; type: string;
  month: number | null; year: number | null;
  start_date?: string | null;
  end_date?: string | null;
  // Optional per-paycheck gross/net breakdown. All values are per-paycheck dollars.
  gross_amount?: number | null;
  federal_tax?: number | null;
  state_tax?: number | null;
  fica?: number | null;
  retirement_401k_amount?: number | null;
  health_insurance?: number | null;
  other_deductions?: number | null;
  paycheck_retirement_account_id?: number | null;
};

type Retirement = { id: number; name: string };

/** An actual check, as printed on a stub. Ground truth for the month it lands
 *  in — analytics prefers it over the rate estimate for that employer. */
type Paycheck = {
  id: number; income_id: number | null; employer: string | null;
  check_date: string; period_start: string | null; period_end: string | null;
  gross: number; net: number; bonus_gross: number | null;
  federal_tax: number | null; state_tax: number | null; fica: number | null;
  retirement_401k: number | null; health_insurance: number | null;
  other_deductions: number | null; source_file: string | null; note: string | null;
};

type ParsedStub = Partial<Paycheck> & {
  ok?: boolean; warnings?: string[]; reconciles?: boolean; reconcile_diff?: number;
  salary_gross?: number | null; source_file?: string; already_imported?: number | null;
};

function hasBreakdown(i: Income): boolean {
  return i.gross_amount != null && i.gross_amount > 0;
}

// ISO date strings (YYYY-MM-DD) compare correctly lexicographically.
function isActiveIncome(i: Income): boolean {
  const today = todayISO();
  if (i.end_date && i.end_date < today) return false;
  if (i.start_date && i.start_date > today) return false;
  return true;
}

function totalDeductions(i: Income): number {
  return (i.federal_tax ?? 0) + (i.state_tax ?? 0) + (i.fica ?? 0)
       + (i.retirement_401k_amount ?? 0) + (i.health_insurance ?? 0) + (i.other_deductions ?? 0);
}

type IncomeEvent = {
  id: number; income_id: number; occurred_on: string; amount: number;
  gross_amount: number | null;
  kind: string; note: string | null;
};

type Budget = {
  id: number; source: string;
  live_pct: number; invest_pct: number; save_pct: number; debt_pct: number; give_pct: number;
};

const EVENT_KINDS: { value: string; label: string }[] = [
  { value: "bonus",      label: "Bonus" },
  { value: "commission", label: "Commission" },
  { value: "payment",    label: "Payment" },
  { value: "tip",        label: "Tip" },
  { value: "other",      label: "Other" },
];

function eventKindLabel(value: string): string {
  return EVENT_KINDS.find((k) => k.value === value)?.label ?? value;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Frequency options shown in the editor.
// `per_check` is kept as a legacy synonym for biweekly so existing records still calculate correctly.
const FREQUENCIES: { value: string; label: string; perYear: number; hint: string }[] = [
  { value: "monthly",     label: "Monthly",       perYear: 12, hint: "Once a month" },
  { value: "biweekly",    label: "Every 2 weeks", perYear: 26, hint: "26 paychecks a year" },
  { value: "semimonthly", label: "Twice a month", perYear: 24, hint: "e.g. on the 1st and 15th" },
  { value: "weekly",      label: "Weekly",        perYear: 52, hint: "52 paychecks a year" },
  { value: "annual",      label: "Yearly",        perYear: 1,  hint: "Once a year" },
];

function monthlyEquivalent(amount: number, frequency: string): number {
  // legacy: per_check used to mean "biweekly" by assumption — keep that meaning
  if (frequency === "per_check") return (amount * 26) / 12;
  const f = FREQUENCIES.find((f) => f.value === frequency);
  if (!f) return amount; // unknown -> assume already-monthly
  return (amount * f.perYear) / 12;
}

function frequencyLabel(value: string): string {
  if (value === "per_check") return "Every 2 weeks (legacy)";
  return FREQUENCIES.find((f) => f.value === value)?.label ?? value;
}

export function Income() {
  const [items, setItems] = useState<Income[]>([]);
  const [events, setEvents] = useState<IncomeEvent[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [retirementAccounts, setRetirementAccounts] = useState<Retirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Income> | null>(null);
  const [raising, setRaising] = useState<Income | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [eventModal, setEventModal] = useState<{ income: Income; ev?: IncomeEvent } | null>(null);
  const [inlineId, setInlineId] = useState<number | null>(null);
  const [inlineDraft, setInlineDraft] = useState<any>({});
  const [inlineBusy, setInlineBusy] = useState(false);
  const [stubOpen, setStubOpen] = useState(false);
  const [paychecks, setPaychecks] = useState<Paycheck[]>([]);

  const currentYear = new Date().getFullYear();

  async function load() {
    setLoading(true);
    try {
      const [a, e, b, r, pc] = await Promise.all([
        api.get<Income[]>("/income"),
        api.get<IncomeEvent[]>(`/income/events?year=${currentYear}`),
        api.get<Budget[]>("/budget"),
        api.get<Retirement[]>("/savings/retirement"),
        api.get<Paycheck[]>(`/income/paychecks?year=${currentYear}`),
      ]);
      setItems(a);
      setEvents(e);
      setBudgets(b);
      setRetirementAccounts(r);
      setPaychecks(pc);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // "Current" figures reflect only income active today — an ended job no longer
  // counts toward your monthly/annual rate (its history stays in the list below).
  const activeItems = useMemo(() => items.filter(isActiveIncome), [items]);
  const activeCount = activeItems.length;

  const monthly = useMemo(() => {
    return activeItems.reduce((s, i) => s + monthlyEquivalent(i.amount, i.frequency), 0);
  }, [activeItems]);

  const monthlyGross = useMemo(() => {
    return activeItems.reduce((s, i) => {
      const gross = hasBreakdown(i) ? (i.gross_amount ?? 0) : i.amount;
      return s + monthlyEquivalent(gross, i.frequency);
    }, 0);
  }, [activeItems]);

  const hasAnyBreakdown = useMemo(() => activeItems.some(hasBreakdown), [activeItems]);

  // Active sources first; ended ones sink to the bottom.
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => Number(isActiveIncome(b)) - Number(isActiveIncome(a))),
    [items],
  );

  const ytdIrregular = useMemo(() => {
    return events.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }, [events]);

  const annual = monthly * 12 + ytdIrregular;

  const eventsByIncome = useMemo(() => {
    const m = new Map<number, IncomeEvent[]>();
    for (const e of events) {
      const arr = m.get(e.income_id) ?? [];
      arr.push(e);
      m.set(e.income_id, arr);
    }
    return m;
  }, [events]);

  async function save(form: Partial<Income>) {
    if (form.id) await api.put(`/income/${form.id}`, form);
    else await api.post("/income", form);
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this income entry? Any attached bonuses/payments will also be removed.")) return;
    await api.del(`/income/${id}`);
    if (expandedId === id) setExpandedId(null);
    load();
  }

  async function saveRaise(id: number, payload: any) {
    await api.post(`/income/${id}/raise`, payload);
    setRaising(null);
    load();
  }

  async function submitEvent(incomeId: number, evId: number | undefined, payload: any) {
    if (evId) await api.put(`/income/events/${evId}`, payload);
    else await api.post(`/income/${incomeId}/events`, payload);
    setEventModal(null);
    load();
  }

  async function removeEvent(eventId: number) {
    if (!confirm("Remove this payment?")) return;
    await api.del(`/income/events/${eventId}`);
    load();
  }

  function startInline(i: Income) {
    setInlineId(i.id);
    setInlineDraft({ source: i.source, type: i.type, frequency: i.frequency, amount: String(i.amount) });
  }
  function cancelInline() { setInlineId(null); setInlineDraft({}); }
  async function commitInline(i: Income) {
    setInlineBusy(true);
    try {
      await save({ ...i, source: inlineDraft.source, type: inlineDraft.type,
                   frequency: inlineDraft.frequency, amount: Number(inlineDraft.amount) || 0 });
      setInlineId(null); setInlineDraft({});
    } finally { setInlineBusy(false); }
  }
  const setInline = (k: string, v: any) => setInlineDraft((p: any) => ({ ...p, [k]: v }));

  async function saveBudget(b: Budget) {
    await api.post("/budget", b);
    load();
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Income</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>What's coming in.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button icon="FileUp" variant="secondary" onClick={() => setStubOpen(true)}>Import pay stub</Button>
          <Button icon="Plus" onClick={() => setEditing({ frequency: "monthly", type: "salary" })}>Add income</Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginBottom: 24 }}>
        <Card>
          <Eyebrow>Monthly{hasAnyBreakdown ? " (take-home)" : ""}</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={monthly} size="xl" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            across {activeCount} active {activeCount === 1 ? "source" : "sources"}
            {items.length > activeCount ? ` · ${items.length - activeCount} ended` : ""}
          </div>
          {hasAnyBreakdown && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-subtle)",
                          fontSize: 12, color: "var(--fg-3)", display: "flex", justifyContent: "space-between" }}>
              <span>Gross before deductions</span>
              <Amount value={monthlyGross} size="sm" muted />
            </div>
          )}
          {ytdIrregular > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-subtle)",
                          fontSize: 12, color: "var(--fg-3)", display: "flex", justifyContent: "space-between" }}>
              <span>+ YTD irregular ({currentYear})</span>
              <Amount value={ytdIrregular} size="sm" muted />
            </div>
          )}
        </Card>
        <Card>
          <Eyebrow>Annual estimate{hasAnyBreakdown ? " (take-home)" : ""}</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={annual} size="xl" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            monthly × 12{ytdIrregular > 0 ? " + YTD irregular" : ""}
          </div>
          {hasAnyBreakdown && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-subtle)",
                          fontSize: 12, color: "var(--fg-3)", display: "flex", justifyContent: "space-between" }}>
              <span>Gross annual</span>
              <Amount value={monthlyGross * 12} size="sm" muted />
            </div>
          )}
        </Card>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No income recorded yet." body="Add a source so we can build the budget around it." icon="TrendingUp"
            action={<Button icon="Plus" onClick={() => setEditing({ frequency: "monthly", type: "salary" })}>Add income</Button>} />
        </Card>
      ) : (
        <Card padding={0}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 140px 140px 140px 150px",
              gap: 16,
              padding: "12px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: 11, fontWeight: 600, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em",
            }}
          >
            <span></span>
            <span>Source</span>
            <span>Type</span>
            <span>Frequency</span>
            <span style={{ textAlign: "right" }}>Amount</span>
            <span></span>
          </div>
          {sortedItems.map((i) => {
            const expanded = expandedId === i.id;
            const rowEvents = eventsByIncome.get(i.id) ?? [];
            const rowYtd = rowEvents.reduce((s, e) => s + (Number(e.amount) || 0), 0);
            const active = isActiveIncome(i);
            const inlineEditing = inlineId === i.id;
            return (
              <div key={i.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr 140px 140px 140px 150px",
                    gap: 16,
                    alignItems: "center",
                    padding: "14px 20px",
                    opacity: active ? 1 : 0.6,
                  }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={expanded ? "ChevronDown" : "ChevronRight"}
                    onClick={() => setExpandedId(expanded ? null : i.id)}
                    style={{ padding: 4, width: 28, height: 28 }}
                  >{""}</Button>
                  {inlineEditing ? (
                    <Input value={inlineDraft.source ?? ""} containerStyle={{ height: 34 }} onChange={(e) => setInline("source", e.target.value)} />
                  ) : (
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                        <Private strength={9}>{i.source}</Private>
                        {!active && (
                          <Badge tone="neutral">
                            {i.end_date ? `Ended ${fmtDate(i.end_date)}` : i.start_date ? `Starts ${fmtDate(i.start_date)}` : "Inactive"}
                          </Badge>
                        )}
                      </div>
                      {active && (i.start_date || i.end_date) && (
                        <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                          {i.start_date ? `Since ${fmtDate(i.start_date)}` : ""}
                        </div>
                      )}
                      {(i.month || i.year) && (
                        <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                          <Private strength={7}>
                            {i.year}{i.month ? `-${String(i.month).padStart(2, "0")}` : ""}
                          </Private>
                        </div>
                      )}
                      {rowYtd > 0 && (
                        <div style={{ marginTop: 2, fontSize: 11, color: "var(--fg-3)" }}>
                          + <Private strength={6}>${fmtMoney(rowYtd)}</Private> YTD ({rowEvents.length})
                        </div>
                      )}
                    </div>
                  )}
                  {inlineEditing ? (
                    <Select value={inlineDraft.type} containerStyle={{ height: 34 }} onChange={(e) => setInline("type", e.target.value)}>
                      <option value="salary">Salary</option>
                      <option value="side_income">Side income</option>
                      <option value="dividend">Dividend</option>
                    </Select>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--fg-2)" }}>{i.type}</div>
                  )}
                  {inlineEditing ? (
                    <Select value={inlineDraft.frequency} containerStyle={{ height: 34 }} onChange={(e) => setInline("frequency", e.target.value)}>
                      {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </Select>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--fg-2)" }}>{frequencyLabel(i.frequency)}</div>
                  )}
                  {inlineEditing ? (
                    <Input prefix="$" inputMode="decimal" value={inlineDraft.amount ?? ""} containerStyle={{ height: 34 }} style={{ textAlign: "right" }} onChange={(e) => setInline("amount", e.target.value)} />
                  ) : (
                    <div style={{ textAlign: "right" }}>
                      <Amount value={i.amount} size="md" />
                      {hasBreakdown(i) && (
                        <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
                          gross <Private strength={6}>${fmtMoney(i.gross_amount ?? 0)}</Private>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                    {inlineEditing ? (
                      <>
                        <Button variant="ghost" size="sm" loading={inlineBusy} onClick={() => commitInline(i)} icon="Check">{""}</Button>
                        <Button variant="ghost" size="sm" onClick={cancelInline} icon="X">{""}</Button>
                      </>
                    ) : (
                      <>
                        {active && (
                          <Button variant="ghost" size="sm" onClick={() => setRaising(i)} icon="TrendingUp" title="Log a raise">{""}</Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => startInline(i)} icon="Pencil" title="Quick edit">{""}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(i)} icon="Settings2" title="Full editor">{""}</Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(i.id)} icon="Trash2">{""}</Button>
                      </>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div style={{ padding: "0 20px 16px 64px", background: "var(--surface-inset)" }}>
                    {hasBreakdown(i) && (
                      <div style={{ padding: "12px 0 8px" }}>
                        <Eyebrow>Paycheck breakdown (per check)</Eyebrow>
                        <div style={{ marginTop: 10, display: "grid",
                                      gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                          <BreakdownLine label="Gross" value={i.gross_amount ?? 0} bold />
                          <BreakdownLine label="Federal tax" value={i.federal_tax ?? 0} negative />
                          <BreakdownLine label="State tax" value={i.state_tax ?? 0} negative />
                          <BreakdownLine label="FICA" value={i.fica ?? 0} negative />
                          <BreakdownLine label="401(k)" value={i.retirement_401k_amount ?? 0} negative />
                          <BreakdownLine label="Health" value={i.health_insurance ?? 0} negative />
                          {(i.other_deductions ?? 0) > 0 && (
                            <BreakdownLine label="Other" value={i.other_deductions ?? 0} negative />
                          )}
                          <BreakdownLine label="Net (take-home)" value={i.amount} bold />
                          <div style={{ gridColumn: "span 3", fontSize: 11, color: "var(--fg-3)" }}>
                            Sanity check: gross − deductions = <Private strength={6}>
                              ${fmtMoney((i.gross_amount ?? 0) - totalDeductions(i))}
                            </Private>
                            {Math.abs((i.gross_amount ?? 0) - totalDeductions(i) - i.amount) > 1 && (
                              <span style={{ color: "var(--warning)", marginLeft: 8 }}>
                                · doesn't match net by ${fmtMoney(Math.abs((i.gross_amount ?? 0) - totalDeductions(i) - i.amount))}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                                  padding: "12px 0 8px 0",
                                  borderTop: hasBreakdown(i) ? "1px solid var(--border-subtle)" : "none",
                                  marginTop: hasBreakdown(i) ? 12 : 0 }}>
                      <Eyebrow>Bonuses, commissions & one-off payments ({currentYear})</Eyebrow>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="Plus"
                        onClick={() => setEventModal({ income: i })}
                      >Add payment</Button>
                    </div>
                    {rowEvents.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--fg-3)", padding: "8px 0 4px" }}>
                        Nothing recorded this year. Add a bonus, commission, or one-off payment.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                        {rowEvents.map((ev) => (
                          <div
                            key={ev.id}
                            onClick={() => setEventModal({ income: i, ev })}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "110px 110px 1fr 110px 32px",
                              gap: 12,
                              alignItems: "center",
                              padding: "8px 0",
                              borderTop: "1px solid var(--border-subtle)",
                              fontSize: 13,
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ color: "var(--fg-2)" }}>{fmtDate(ev.occurred_on)}</div>
                            <div style={{ color: "var(--fg-1)" }}>{eventKindLabel(ev.kind)}</div>
                            <div style={{ color: "var(--fg-3)", fontSize: 12, overflow: "hidden",
                                          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ev.note || ""}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <Amount value={ev.amount} size="sm" />
                              {ev.gross_amount != null && (
                                <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>
                                  gross <Private strength={6}>${fmtMoney(ev.gross_amount)}</Private>
                                </div>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="Trash2"
                              onClick={(e) => { e.stopPropagation(); removeEvent(ev.id); }}
                              style={{ padding: 4, width: 28, height: 28 }}
                            >{""}</Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {paychecks.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <Eyebrow>Paychecks received ({currentYear})</Eyebrow>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            Imported stubs. A month with a real check uses it instead of the estimated rate.
          </div>
          <Card padding={0} style={{ marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 130px 120px 120px 44px", gap: 12,
                          padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)",
                          fontSize: 11, fontWeight: 600, color: "var(--fg-3)",
                          textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span>Check date</span><span>Employer</span>
              <span style={{ textAlign: "right" }}>Gross</span>
              <span style={{ textAlign: "right" }}>Bonus</span>
              <span style={{ textAlign: "right" }}>Net</span><span></span>
            </div>
            {paychecks.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr 130px 120px 120px 44px",
                                       gap: 12, alignItems: "center", padding: "10px 20px",
                                       borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>
                <span style={{ color: "var(--fg-1)" }}>{fmtDate(p.check_date)}</span>
                <span style={{ color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.employer || "—"}
                  {p.period_start && p.period_end && (
                    <span style={{ color: "var(--fg-4)", fontSize: 12 }}>
                      {"  "}{fmtDate(p.period_start)}–{fmtDate(p.period_end)}
                    </span>
                  )}
                </span>
                <span style={{ textAlign: "right" }}><Amount value={p.gross} size="sm" muted /></span>
                <span style={{ textAlign: "right" }}>
                  {p.bonus_gross ? <Amount value={p.bonus_gross} size="sm" /> :
                    <span style={{ color: "var(--fg-4)" }}>—</span>}
                </span>
                <span style={{ textAlign: "right" }}><Amount value={p.net} size="sm" /></span>
                <Button variant="ghost" size="sm" icon="Trash2"
                        onClick={async () => {
                          if (!confirm(`Remove the ${fmtDate(p.check_date)} paycheck?`)) return;
                          await api.del(`/income/paychecks/${p.id}`);
                          load();
                        }}>{""}</Button>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <Eyebrow>Budget allocation</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--fg-2)" }}>
          How each take-home dollar is split across living, investing, saving, debt paydown, and giving.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} monthly={monthly} onSave={saveBudget} />
          ))}
        </div>
      </div>

      <BudgetActual />

      {editing && (
        <IncomeEditor
          initial={editing}
          retirementAccounts={retirementAccounts}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {eventModal && (
        <EventEditor
          income={eventModal.income}
          initial={eventModal.ev}
          onClose={() => setEventModal(null)}
          onSave={(payload) => submitEvent(eventModal.income.id, eventModal.ev?.id, payload)}
        />
      )}
      {raising && (
        <RaiseModal
          income={raising}
          onClose={() => setRaising(null)}
          onSave={(payload) => saveRaise(raising.id, payload)}
        />
      )}
      {stubOpen && (
        <PayStubModal
          incomes={items}
          onClose={() => setStubOpen(false)}
          onSaved={() => { setStubOpen(false); load(); }}
        />
      )}
    </>
  );
}

/** Upload a pay stub, review what was read, then save it as a real paycheck.
 *  Always a review step — a misread figure would quietly corrupt income history,
 *  so nothing is written until the numbers are confirmed on screen. */
function PayStubModal({ incomes, onClose, onSaved }: {
  incomes: Income[]; onClose: () => void; onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stub, setStub] = useState<ParsedStub | null>(null);
  const [form, setForm] = useState<any>({});

  async function pick(file: File) {
    setBusy(true); setError(null); setStub(null);
    try {
      const parsed = await api.upload<ParsedStub>("/income/paystub/parse", file);
      setStub(parsed);
      setForm({
        ...parsed,
        income_id: parsed.income_id ?? "",
        source_file: parsed.source_file ?? file.name,
      });
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't read that file.");
    } finally { setBusy(false); }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const withheld = ["federal_tax", "state_tax", "fica", "retirement_401k",
                    "health_insurance", "other_deductions"]
    .reduce((s, k) => s + (Number(form[k]) || 0), 0);
  const gross = Number(form.gross) || 0;
  const net = Number(form.net) || 0;
  // Recomputed live so edits are checked too, not just the initial parse.
  const diff = Math.round((gross - withheld - net) * 100) / 100;
  const balances = Math.abs(diff) <= 1;

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.post("/income/paychecks", {
        ...form,
        income_id: form.income_id === "" ? null : Number(form.income_id),
        replace: true,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't save that paycheck.");
    } finally { setBusy(false); }
  }

  const NUM_FIELDS: [string, string][] = [
    ["gross", "Gross"], ["net", "Net (take-home)"], ["bonus_gross", "Bonus (part of gross)"],
    ["federal_tax", "Federal tax"], ["state_tax", "State + local"], ["fica", "FICA"],
    ["retirement_401k", "401k"], ["health_insurance", "Health"], ["other_deductions", "Other deductions"],
  ];

  return (
    <Modal open onClose={onClose} title="Import a pay stub" width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="Check" loading={busy}
                  disabled={!stub || !form.check_date || !net} onClick={save}>
            Save paycheck
          </Button>
        </>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: "none" }}
               onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />

        {!stub && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)" }}>
              Drop in the PDF from your payroll site. Everything is read locally and shown
              for review — nothing is saved until you confirm it.
            </p>
            <div>
              <Button variant="secondary" icon="FileUp" loading={busy}
                      onClick={() => fileRef.current?.click()}>Choose a stub</Button>
            </div>
          </>
        )}

        {error && (
          <Card style={{ borderColor: "var(--danger)" }}>
            <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>
          </Card>
        )}

        {stub && (
          <>
            {stub.already_imported && (
              <Card style={{ borderColor: "var(--warning)" }}>
                <div style={{ fontSize: 13, color: "var(--warning)" }}>
                  This stub is already recorded. Saving will update the existing entry.
                </div>
              </Card>
            )}
            {(stub.warnings ?? []).map((w, i) => (
              <Card key={i} style={{ borderColor: "var(--warning)" }}>
                <div style={{ fontSize: 13, color: "var(--warning)" }}>{w}</div>
              </Card>
            ))}

            <Card style={{ borderColor: balances ? "var(--success)" : "var(--danger)" }}>
              <div style={{ fontSize: 13, color: balances ? "var(--fg-2)" : "var(--danger)" }}>
                {balances
                  ? `Gross − withholdings = net. Checks out${diff !== 0 ? ` (off by $${fmtMoney(Math.abs(diff))})` : ""}.`
                  : `Gross − withholdings is off from net by $${fmtMoney(Math.abs(diff))}. Fix a figure before saving.`}
              </div>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Employer">
                <Input value={form.employer ?? ""} onChange={(e) => set("employer", e.target.value)} />
              </Field>
              <Field label="Income source">
                <Select value={String(form.income_id ?? "")}
                        onChange={(e) => set("income_id", e.target.value)}>
                  <option value="">Not linked</option>
                  {incomes.map((i) => <option key={i.id} value={i.id}>{i.source}</option>)}
                </Select>
              </Field>
              <Field label="Check date">
                <Input type="date" value={form.check_date ?? ""} onChange={(e) => set("check_date", e.target.value)} />
              </Field>
              <Field label="Period">
                <div style={{ display: "flex", gap: 6 }}>
                  <Input type="date" value={form.period_start ?? ""} onChange={(e) => set("period_start", e.target.value)} />
                  <Input type="date" value={form.period_end ?? ""} onChange={(e) => set("period_end", e.target.value)} />
                </div>
              </Field>
              {NUM_FIELDS.map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input prefix="$" inputMode="decimal" value={form[key] ?? ""}
                         onChange={(e) => set(key, e.target.value)} />
                </Field>
              ))}
            </div>

            <div>
              <Button variant="ghost" size="sm" icon="RotateCcw"
                      onClick={() => { setStub(null); setForm({}); }}>Choose a different file</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function RaiseModal({
  income, onClose, onSave,
}: { income: Income; onClose: () => void; onSave: (payload: any) => void }) {
  const [amount, setAmount] = useState(String(income.amount));
  const [gross, setGross] = useState(income.gross_amount != null ? String(income.gross_amount) : "");
  const [date, setDate] = useState(todayISO());
  const breakdown = hasBreakdown(income);
  const delta = (Number(amount) || 0) - income.amount;

  return (
    <Modal
      open onClose={onClose}
      title={`Log a raise — ${income.source}`}
      subtitle="Keeps the old rate before this date and starts the new one after, so your history stays accurate."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave({
            amount: Number(amount) || 0,
            effective_date: date,
            gross_amount: gross === "" ? null : Number(gross),
          })}>Apply raise</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="New net per check">
            <Input prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Effective date" hint="first check at the new rate">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {breakdown && (
          <Field label="New gross per check (optional)" hint="leave blank to fill later, e.g. by importing the new pay stub">
            <Input prefix="$" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} />
          </Field>
        )}
        {Math.abs(delta) > 0.005 && (
          <div style={{ fontSize: 13, color: delta >= 0 ? "var(--success)" : "var(--warning)" }}>
            {delta >= 0 ? "+" : "−"}${fmtMoney(Math.abs(delta))} per check vs the current ${fmtMoney(income.amount)}.
          </div>
        )}
      </div>
    </Modal>
  );
}

function EventEditor({
  income, initial, onClose, onSave,
}: { income: Income; initial?: IncomeEvent; onClose: () => void; onSave: (payload: any) => void }) {
  // Default kind: salary sources -> "bonus", everything else -> "payment"
  const defaultKind = income.type === "salary" ? "bonus" : "payment";
  const [form, setForm] = useState<any>({
    kind: initial?.kind ?? defaultKind,
    occurred_on: initial?.occurred_on ?? todayISO(),
    amount: initial?.amount != null ? String(initial.amount) : "",
    gross_amount: initial?.gross_amount != null ? String(initial.gross_amount) : "",
    note: initial?.note ?? "",
  });
  const canSave = Number(form.amount) > 0 && !!form.occurred_on;
  const gross = Number(form.gross_amount) || 0;
  const net = Number(form.amount) || 0;
  const withheld = gross > 0 ? gross - net : 0;

  return (
    <Modal
      open onClose={onClose}
      title={initial ? "Edit payment" : `Add payment to ${income.source}`}
      subtitle="Net is what hit your account — it's what counts toward take-home."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="md"
            disabled={!canSave}
            onClick={() => onSave({
              kind: form.kind,
              occurred_on: form.occurred_on,
              amount: Number(form.amount) || 0,
              gross_amount: form.gross_amount === "" ? null : Number(form.gross_amount),
              note: form.note || null,
            })}
          >Save</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Kind" style={{ flex: 1 }}>
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {EVENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date" style={{ flex: 1 }}>
            <Input
              type="date"
              value={form.occurred_on}
              onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
            />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Net (take-home)" style={{ flex: 1 }}>
            <Input
              prefix="$"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              inputMode="decimal"
            />
          </Field>
          <Field label="Gross (optional)" style={{ flex: 1 }} hint="pre-tax, before withholding">
            <Input
              prefix="$"
              value={form.gross_amount}
              onChange={(e) => setForm({ ...form, gross_amount: e.target.value })}
              placeholder="0.00"
              inputMode="decimal"
            />
          </Field>
        </div>
        {gross > 0 && (
          <div style={{ fontSize: 12, color: withheld < 0 ? "var(--warning)" : "var(--fg-3)" }}>
            {withheld >= 0
              ? `~$${fmtMoney(withheld)} withheld (taxes, 401(k), HSA, etc.). Take-home counts $${fmtMoney(net)}.`
              : "Net is higher than gross — check the figures."}
          </div>
        )}
        <Field label="Note (optional)">
          <Textarea
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="e.g. Q1 performance bonus, project XYZ payout"
            rows={2}
          />
        </Field>
      </div>
    </Modal>
  );
}

type BACat = { key: string; label: string; pct: number; target: number; actual: number };
type BAResp = { period: string; base_income: number; months: number; categories: BACat[] };

function BudgetActual() {
  const [period, setPeriod] = useState<"month" | "ytd">("month");
  const [data, setData] = useState<BAResp | null>(null);
  useEffect(() => {
    api.get<BAResp>(`/analytics/budget-actual?period=${period}`).then(setData).catch(() => setData(null));
  }, [period]);

  const hasBudget = !!data && data.categories.some((c) => c.pct > 0);

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Eyebrow>Budget vs actual</Eyebrow>
        <Segmented
          options={[{ label: "This month", value: "month" }, { label: "Year to date", value: "ytd" }]}
          value={period}
          onChange={(v) => setPeriod(v as any)}
        />
      </div>
      {!data ? null : !hasBudget ? (
        <Card><div style={{ fontSize: 13, color: "var(--fg-3)" }}>Set your allocation %s above to compare against what actually happened.</div></Card>
      ) : (
        <Card>
          <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 14 }}>
            Against ${fmtMoney(data.base_income)} take-home {period === "ytd" ? "this year so far" : "this month"}.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.categories.filter((c) => c.pct > 0 || c.actual !== 0).map((c) => <BARow key={c.key} c={c} />)}
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: "var(--fg-3)" }}>
            Debt = planned monthly payment · Saving = what's left after everything else.
          </div>
        </Card>
      )}
    </div>
  );
}

function BARow({ c }: { c: BACat }) {
  // Spend categories overspending is bad; savings-type underfunding is "behind".
  const spendish = c.key === "live" || c.key === "debt";
  const over = c.actual > c.target;
  const ratio = c.target > 0 ? c.actual / c.target : (c.actual > 0 ? 1.5 : 0);
  const good = spendish ? c.actual <= c.target * 1.02 : c.actual >= c.target * 0.95;
  const fillColor = good ? "var(--success)" : "var(--warning)";
  const status = spendish
    ? (over ? `$${fmtMoney(c.actual - c.target)} over` : `$${fmtMoney(c.target - c.actual)} under`)
    : (c.actual >= c.target ? "on/ahead of target" : `$${fmtMoney(c.target - c.actual)} behind`);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "var(--fg-1)", fontWeight: 500 }}>{c.label} <span style={{ color: "var(--fg-3)", fontSize: 11 }}>({c.pct}%)</span></span>
        <span style={{ color: "var(--fg-3)" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>${fmtMoney(c.actual)}</span> / ${fmtMoney(c.target)}
        </span>
      </div>
      <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", background: fillColor, transition: "width var(--dur-state) var(--ease)" }} />
        {c.target > 0 && (
          <div style={{ position: "absolute", top: -2, bottom: -2, left: "100%", width: 2, background: "var(--fg-3)", opacity: 0.5 }} />
        )}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, textAlign: "right", color: good ? "var(--success)" : "var(--warning)" }}>{status}</div>
    </div>
  );
}

function BudgetCard({ budget, monthly, onSave }: { budget: Budget; monthly: number; onSave: (b: Budget) => void }) {
  const [b, setB] = useState(budget);
  const total = b.live_pct + b.invest_pct + b.save_pct + b.debt_pct + b.give_pct;
  const off = Math.abs(total - 100) > 0.01;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            <Private strength={9}>{b.source}</Private>
          </div>
          <div style={{ fontSize: 12, color: off ? "var(--warning)" : "var(--fg-3)", marginTop: 2 }}>
            Total: {total.toFixed(0)}%{off ? " · Should add to 100" : ""}
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => onSave(b)} disabled={off}>Save</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
        {(["live", "invest", "save", "debt", "give"] as const).map((k) => {
          const pct = b[`${k}_pct` as keyof Budget] as number;
          const dollar = (pct / 100) * monthly;
          return (
            <div key={k}>
              <Field label={k.charAt(0).toUpperCase() + k.slice(1) + " %"}>
                <Input
                  value={pct}
                  onChange={(e) => setB({ ...b, [`${k}_pct`]: Number(e.target.value) || 0 } as any)}
                />
              </Field>
              <div style={{ marginTop: 4, fontSize: 11, color: "var(--fg-3)" }}>
                ≈ ${fmtMoney(dollar)}/mo
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BreakdownLine({ label, value, bold, negative }: { label: string; value: number; bold?: boolean; negative?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "2px 0",
    }}>
      <span style={{ color: bold ? "var(--fg-1)" : "var(--fg-3)", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ color: negative ? "var(--fg-3)" : bold ? "var(--fg-1)" : "var(--fg-2)",
                     fontFamily: "var(--font-mono)", fontWeight: bold ? 600 : 400 }}>
        {negative && value > 0 ? "−" : ""}<Private strength={6}>${fmtMoney(value)}</Private>
      </span>
    </div>
  );
}

function IncomeEditor({
  initial, retirementAccounts, onClose, onSave,
}: {
  initial: Partial<Income>;
  retirementAccounts: Retirement[];
  onClose: () => void;
  onSave: (i: any) => void;
}) {
  const [form, setForm] = useState<any>({ ...initial });
  const [showBreakdown, setShowBreakdown] = useState<boolean>(
    !!(initial.gross_amount && initial.gross_amount > 0)
  );
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);
  const stubInputRef = useRef<HTMLInputElement>(null);

  const isSalary = (form.type ?? "salary") === "salary";

  async function importStub(file: File) {
    setParsing(true);
    setParseNote(null);
    try {
      const d = await api.upload<any>("/income/parse-document", file);
      const pick = (v: any, cur: any) => (v != null ? String(v) : cur);
      setForm((f: any) => ({
        ...f,
        source: f.source || d.employer || f.source,
        amount: pick(d.net, f.amount),
        frequency: d.frequency || f.frequency,
        gross_amount: pick(d.gross, f.gross_amount),
        federal_tax: pick(d.federal_tax, f.federal_tax),
        state_tax: pick(d.state_tax, f.state_tax),
        fica: pick(d.fica, f.fica),
        retirement_401k_amount: pick(d.retirement_401k, f.retirement_401k_amount),
        health_insurance: pick(d.health, f.health_insurance),
        other_deductions: pick(d.other, f.other_deductions),
      }));
      if (d.gross != null || d.federal_tax != null) setShowBreakdown(true);
      if (d.low_confidence) {
        setParseNote({
          tone: "danger",
          text: "This stub didn't read cleanly — the numbers don't reconcile (gross − deductions ≠ net). Don't trust these; check each field against your stub or type them in. ADP-style stubs often confuse the model.",
        });
      } else if (d.doc_type === "paycheck") {
        setParseNote({ tone: "info", text: "Imported from pay stub — review the values, then save." });
      } else {
        setParseNote({
          tone: "warning",
          text: `This looks like a ${d.doc_type === "bonus" ? "bonus" : "one-off payment"}. I filled the amount, but one-off income is better logged as a payment from the Import page or the source's "Add payment" button.`,
        });
      }
    } catch (e: any) {
      setParseNote({ tone: "danger", text: e?.payload?.message || e?.message || "Couldn't read that document." });
    } finally {
      setParsing(false);
    }
  }

  const breakdown = useMemo(() => {
    const gross = Number(form.gross_amount) || 0;
    const fed = Number(form.federal_tax) || 0;
    const state = Number(form.state_tax) || 0;
    const fica = Number(form.fica) || 0;
    const ret = Number(form.retirement_401k_amount) || 0;
    const health = Number(form.health_insurance) || 0;
    const other = Number(form.other_deductions) || 0;
    const totalDed = fed + state + fica + ret + health + other;
    const computedNet = gross - totalDed;
    return { gross, totalDed, computedNet };
  }, [form.gross_amount, form.federal_tax, form.state_tax, form.fica,
      form.retirement_401k_amount, form.health_insurance, form.other_deductions]);

  function useComputedNet() {
    setForm({ ...form, amount: breakdown.computedNet.toFixed(2) });
  }

  function buildPayload() {
    const payload: any = { ...form, amount: Number(form.amount) || 0 };
    if (!showBreakdown) {
      // Clearing breakdown fields when section is collapsed off
      payload.gross_amount = null;
      payload.federal_tax = null;
      payload.state_tax = null;
      payload.fica = null;
      payload.retirement_401k_amount = null;
      payload.health_insurance = null;
      payload.other_deductions = null;
      payload.paycheck_retirement_account_id = null;
    }
    return payload;
  }

  return (
    <Modal
      open onClose={onClose}
      width={600}
      title={initial.id ? "Edit income" : "Add income"}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => onSave(buildPayload())}>Save</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <Field label="Source" style={{ flex: 1 }}>
            <Input value={form.source ?? ""} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Me, Main job" />
          </Field>
          <input
            ref={stubInputRef}
            type="file"
            accept=".pdf,.txt"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importStub(f); e.currentTarget.value = ""; }}
          />
          <Button variant="secondary" size="md" icon="Upload" loading={parsing} onClick={() => stubInputRef.current?.click()}>
            Import pay stub
          </Button>
        </div>
        {parseNote && (
          <div style={{
            fontSize: 12, padding: "8px 12px", borderRadius: "var(--r-md)",
            background: "var(--surface-inset)", border: "1px solid var(--border-subtle)",
            color: parseNote.tone === "danger" ? "var(--danger)" : parseNote.tone === "warning" ? "var(--warning)" : "var(--fg-2)",
          }}>
            {parseNote.text}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <Field label={showBreakdown ? "Net per check" : "Amount per check"}>
            <Input prefix="$" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Frequency" hint={FREQUENCIES.find((f) => f.value === form.frequency)?.hint}>
            <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
              {form.frequency === "per_check" && (
                <option value="per_check">Every 2 weeks (legacy)</option>
              )}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="salary">Salary</option>
              <option value="side_income">Side income</option>
              <option value="dividend">Dividend</option>
            </Select>
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <Field label="Started" hint="optional — when this income began">
            <Input type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Ended" hint="set when you leave — history stays, it just stops counting">
            <Input type="date" value={form.end_date ?? ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
        </div>

        {isSalary && (
          <div style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-md)",
            padding: "12px 14px",
            background: "var(--surface-inset)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-1)" }}>Paycheck breakdown</div>
                <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
                  Optional. Lets Reports show pre-tax & auto-flow 401(k) to Investments.
                </div>
              </div>
              <Button variant="ghost" size="sm"
                      icon={showBreakdown ? "ChevronUp" : "ChevronDown"}
                      onClick={() => setShowBreakdown(!showBreakdown)}>
                {showBreakdown ? "Hide" : "Add"}
              </Button>
            </div>

            {showBreakdown && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <Field label="Gross per check">
                  <Input prefix="$" value={form.gross_amount ?? ""}
                         onChange={(e) => setForm({ ...form, gross_amount: e.target.value })}
                         inputMode="decimal" placeholder="0.00" />
                </Field>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <Field label="Federal"><Input prefix="$" value={form.federal_tax ?? ""}
                    onChange={(e) => setForm({ ...form, federal_tax: e.target.value })} inputMode="decimal" /></Field>
                  <Field label="State"><Input prefix="$" value={form.state_tax ?? ""}
                    onChange={(e) => setForm({ ...form, state_tax: e.target.value })} inputMode="decimal" /></Field>
                  <Field label="FICA"><Input prefix="$" value={form.fica ?? ""}
                    onChange={(e) => setForm({ ...form, fica: e.target.value })} inputMode="decimal" /></Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <Field label="Health"><Input prefix="$" value={form.health_insurance ?? ""}
                    onChange={(e) => setForm({ ...form, health_insurance: e.target.value })} inputMode="decimal" /></Field>
                  <Field label="401(k)"><Input prefix="$" value={form.retirement_401k_amount ?? ""}
                    onChange={(e) => setForm({ ...form, retirement_401k_amount: e.target.value })} inputMode="decimal" /></Field>
                  <Field label="Other"><Input prefix="$" value={form.other_deductions ?? ""}
                    onChange={(e) => setForm({ ...form, other_deductions: e.target.value })} inputMode="decimal" placeholder="HSA, etc." /></Field>
                </div>
                <Field label="401(k) account" hint="Where this 401(k) deduction lands on the Investments page">
                  <Select value={form.paycheck_retirement_account_id ?? ""}
                          onChange={(e) => setForm({ ...form, paycheck_retirement_account_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— Not linked —</option>
                    {retirementAccounts.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </Select>
                </Field>

                <div style={{
                  marginTop: 4, padding: "10px 12px", borderRadius: "var(--r-md)",
                  background: "var(--surface-1)", border: "1px solid var(--border-subtle)",
                  fontSize: 13,
                }}>
                  <BreakdownLine label="Gross" value={breakdown.gross} bold />
                  <BreakdownLine label="− Deductions" value={breakdown.totalDed} negative />
                  <div style={{ height: 1, background: "var(--border-subtle)", margin: "6px 0" }} />
                  <BreakdownLine label="Computed net" value={breakdown.computedNet} bold />
                  {Math.abs(breakdown.computedNet - (Number(form.amount) || 0)) > 1 && breakdown.gross > 0 && (
                    <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 11, color: "var(--warning)", flex: 1, minWidth: 0 }}>
                        Doesn't match Net field (${fmtMoney(Number(form.amount) || 0)}).
                      </span>
                      <Button variant="ghost" size="sm" onClick={useComputedNet}>Use computed</Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
