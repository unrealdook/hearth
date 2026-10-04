import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { ordinalDay, fmtMoney } from "@/lib/format";
import {
  Card, Button, Badge, VendorIcon, Amount, Eyebrow, Spinner, EmptyState, Input,
  Segmented, Select,
} from "@/components/ui";
import { Bill, EMPTY_BILL } from "@/types/bill";
import { BillDetailPanel } from "@/components/bills/BillDetailPanel";
import { BillEditor } from "@/components/bills/BillEditor";

type PaymentRec = {
  id: number; bill_id: number; month: number; year: number;
  amount_paid: number; paid: boolean; paid_date: string | null;
  // null = follow the bill's auto-pay setting; `deducts` is the resolved answer.
  // Optional on purpose — a stale backend won't send it, and the type should
  // force callers to say what happens then.
  skip_deduction?: boolean | null; deducts?: boolean;
};

type PayFromAccount = { id: number; name: string; balance: number };

type Drift = {
  bill_id: number; name: string; category: string; estimate: number;
  suggested: number; delta: number; months: number; recent: number[]; spread: number;
};
type DriftResp = { bills: Drift[]; count: number; monthly_delta: number };

export function Payments() {
  const navigate = useNavigate();
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [bills, setBills] = useState<Bill[]>([]);
  const [records, setRecords] = useState<PaymentRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [editing, setEditing] = useState<Bill | typeof EMPTY_BILL | null>(null);
  const [filter, setFilter] = useState<"all" | "unpaid" | "paid">("all");
  const [sort, setSort] = useState<"due" | "name" | "amount" | "status">("due");
  // undefined = not loaded yet, null = no pay-from account configured, object = set
  const [payFrom, setPayFrom] = useState<PayFromAccount | null | undefined>(undefined);
  const [drift, setDrift] = useState<DriftResp | null>(null);
  const [driftOpen, setDriftOpen] = useState(false);
  const [dismissedDrift, setDismissedDrift] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const [b, p, pf] = await Promise.all([
        api.get<Bill[]>("/bills?active=true"),
        api.get<PaymentRec[]>(`/payments?month=${month}&year=${year}`),
        api.get<{ account_id: number | null; account: PayFromAccount | null }>("/savings/pay-from"),
      ]);
      setBills(b);
      setRecords(p);
      setPayFrom(pf.account);
    } finally { setLoading(false); }
    // Non-blocking: a stale-estimate nudge shouldn't hold up the bill list.
    api.get<DriftResp>("/analytics/bill-drift").then(setDrift).catch(() => setDrift(null));
  }

  /** Adopt the suggested amount as the bill's new estimate. */
  async function acceptDrift(d: Drift) {
    await api.put(`/bills/${d.bill_id}`, { amount: d.suggested });
    setDismissedDrift((s) => new Set(s).add(d.bill_id));
    load();
  }

  useEffect(() => { load(); }, [month, year]);

  // keep `selected` in sync with the latest bill data after `load()`
  useEffect(() => {
    if (!selected) return;
    const fresh = bills.find((b) => b.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [bills, selected]);

  const recordByBill = useMemo(() => {
    const m = new Map<number, PaymentRec>();
    for (const r of records) m.set(r.bill_id, r);
    return m;
  }, [records]);

  const visibleBills = useMemo(() => {
    const isPaid = (b: Bill) => !!recordByBill.get(b.id)?.paid;
    const filtered = filter === "all"
      ? bills
      : bills.filter((b) => (filter === "paid" ? isPaid(b) : !isPaid(b)));
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "name": return a.name.localeCompare(b.name);
        case "amount": return (b.amount || 0) - (a.amount || 0);
        // Unpaid first, then by due day so the to-do list rises to the top.
        case "status": return (Number(isPaid(a)) - Number(isPaid(b))) || ((a.due_day ?? 99) - (b.due_day ?? 99));
        case "due":
        default: return (a.due_day ?? 99) - (b.due_day ?? 99);
      }
    });
  }, [bills, recordByBill, filter, sort]);

  const totals = useMemo(() => {
    const total_due = bills.reduce((s, b) => s + (b.amount || 0), 0);
    const total_paid = records.filter((r) => r.paid).reduce((s, r) => s + (r.amount_paid || 0), 0);
    const remaining = Math.max(0, total_due - total_paid);
    return { total_due, total_paid, remaining };
  }, [bills, records]);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    setMonth(m); setYear(y);
  }

  async function togglePaid(bill: Bill) {
    const rec = recordByBill.get(bill.id);
    if (rec) {
      await api.put(`/payments/${rec.id}`, { paid: !rec.paid });
    } else {
      await api.post("/payments", { bill_id: bill.id, month, year, paid: true, amount_paid: bill.amount });
    }
    load();
  }

  /** Record the month as paid but leave the pay-from balance alone — for a
   *  charge the bank already took on its own. */
  async function markPaidNoDeduct(bill: Bill) {
    const rec = recordByBill.get(bill.id);
    if (rec) {
      await api.put(`/payments/${rec.id}`, { paid: true, skip_deduction: true });
    } else {
      await api.post("/payments", {
        bill_id: bill.id, month, year, paid: true, amount_paid: bill.amount, skip_deduction: true,
      });
    }
    load();
  }

  async function updateAmount(bill: Bill, amount: number) {
    const rec = recordByBill.get(bill.id);
    if (rec) {
      await api.put(`/payments/${rec.id}`, { amount_paid: amount });
    } else {
      await api.post("/payments", { bill_id: bill.id, month, year, amount_paid: amount });
    }
    load();
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Payments</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Tick off what's paid each month. Click a row for credentials and the pay flow.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="secondary" size="md" onClick={() => shift(-1)} icon="ChevronLeft">{""}</Button>
          <div style={{ minWidth: 160, textAlign: "center", fontSize: 14, fontWeight: 500 }}>{monthLabel}</div>
          <Button variant="secondary" size="md" onClick={() => shift(1)} icon="ChevronRight">{""}</Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        <Card>
          <Eyebrow>Total this month</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.total_due} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{bills.length} bills</div>
        </Card>
        <Card>
          <Eyebrow>Paid</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.total_paid} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            {records.filter((r) => r.paid).length} of {bills.length}
          </div>
        </Card>
        <Card>
          <Eyebrow>Remaining</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.remaining} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>still to pay</div>
        </Card>
        {payFrom ? (
          <Card>
            <Eyebrow>Paying from</Eyebrow>
            <div style={{ marginTop: 12 }}><Amount value={payFrom.balance} size="lg" /></div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{payFrom.name}</div>
          </Card>
        ) : (
          <Card>
            <Eyebrow>Paying from</Eyebrow>
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--fg-3)" }}>No account set.</div>
            <button
              onClick={() => navigate("/savings")}
              style={{ marginTop: 6, fontSize: 12, color: "var(--brand)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              Set up →
            </button>
          </Card>
        )}
      </div>

      {bills.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            options={[
              { label: "All", value: "all" },
              { label: "Unpaid", value: "unpaid" },
              { label: "Paid", value: "paid" },
            ]}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Sort by</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 150 }}>
              <option value="due">Due date</option>
              <option value="status">Status</option>
              <option value="name">Name</option>
              <option value="amount">Amount</option>
            </Select>
          </div>
        </div>
      )}

      {(() => {
        const rows = (drift?.bills ?? []).filter((d) => !dismissedDrift.has(d.bill_id));
        if (rows.length === 0) return null;
        const net = rows.reduce((s, d) => s + d.delta, 0);
        return (
          <Card style={{ marginBottom: 16, borderColor: "var(--warning)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>
                  {rows.length} estimate{rows.length === 1 ? "" : "s"} {rows.length === 1 ? "looks" : "look"} stale
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
                  Your monthly total is off by {net < 0 ? "−" : "+"}${fmtMoney(Math.abs(net))} versus what you actually pay.
                  Estimates drive the forecast and upcoming list.
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDriftOpen((v) => !v)}>
                {driftOpen ? "Hide" : "Review"}
              </Button>
            </div>
            {driftOpen && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.map((d) => (
                  <div key={d.bill_id}
                       style={{ display: "grid", gridTemplateColumns: "1fr 210px 150px", gap: 12,
                                alignItems: "center", paddingTop: 10,
                                borderTop: "1px solid var(--border-subtle)" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--fg-1)" }}>{d.name.trim()}</div>
                      <div style={{ fontSize: 11, color: "var(--fg-4)" }}>
                        {d.months} months{d.spread > 0 ? ` · varies by $${fmtMoney(d.spread)}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>
                      ${fmtMoney(d.estimate)} → <span style={{ color: "var(--fg-1)" }}>${fmtMoney(d.suggested)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <Button variant="secondary" size="sm" onClick={() => acceptDrift(d)}>Update</Button>
                      <Button variant="ghost" size="sm"
                              onClick={() => setDismissedDrift((s) => new Set(s).add(d.bill_id))}>Keep</Button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 2 }}>
                  Suggestions are the median of recent payments, so one catch-up month doesn't skew them.
                </div>
              </div>
            )}
          </Card>
        );
      })()}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : bills.length === 0 ? (
        <Card><EmptyState title="No bills yet." body="Add bills first, then come back here to track payments." icon="Receipt" /></Card>
      ) : visibleBills.length === 0 ? (
        <Card><EmptyState title={filter === "paid" ? "Nothing paid yet." : "All caught up."} body={filter === "paid" ? "No bills marked paid for this month." : "No unpaid bills for this month."} icon="Receipt" /></Card>
      ) : (
        <Card padding={0}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 80px 110px 160px 190px",
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
            <span style={{ textAlign: "right" }}>Due</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Amount paid</span>
            <span></span>
          </div>
          {visibleBills.map((b) => {
            const rec = recordByBill.get(b.id);
            return (
              <PaymentRow
                key={b.id}
                bill={b}
                record={rec}
                payFromOn={!!payFrom}
                onClick={() => setSelected(b)}
                onToggle={() => togglePaid(b)}
                onPaidNoDeduct={() => markPaidNoDeduct(b)}
                onAmount={(a) => updateAmount(b, a)}
              />
            );
          })}
        </Card>
      )}

      {selected && (
        <BillDetailPanel
          bill={selected}
          onClose={() => setSelected(null)}
          onPaid={() => { setSelected(null); load(); }}
          onEdit={() => { setEditing(selected); setSelected(null); }}
        />
      )}

      {editing && (
        <BillEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function PaymentRow({
  bill, record, payFromOn, onClick, onToggle, onPaidNoDeduct, onAmount,
}: {
  bill: Bill;
  record?: PaymentRec;
  payFromOn: boolean;
  onClick: () => void;
  onToggle: () => void;
  onPaidNoDeduct: () => void;
  onAmount: (a: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(record?.amount_paid ?? bill.amount));
  const [hover, setHover] = useState(false);
  const paid = !!record?.paid;
  // The bill's own auto-pay setting decides until a record says otherwise.
  // `??` (not a truthiness check) so a missing/older `deducts` field falls back
  // to the bill rather than reading as "this won't touch your balance" — that
  // claim has to be earned, never assumed.
  const deducts = record?.deducts ?? !bill.is_autopay;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr 80px 110px 160px 190px",
        gap: 16,
        alignItems: "center",
        padding: "14px 20px",
        borderBottom: "1px solid var(--border-subtle)",
        background: hover ? "var(--surface-2)" : "transparent",
        cursor: "pointer",
        transition: "background var(--dur-micro) var(--ease)",
      }}
    >
      <VendorIcon kind={bill.kind} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{bill.name}</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
          {bill.category}{bill.is_autopay ? " · Auto-pay" : ""}
          {payFromOn && !deducts && (
            <span style={{ color: "var(--fg-4)" }}> · doesn't move your balance</span>
          )}
          {/* A cleared card still bills each month, so say the balance is zero
              rather than letting the default amount imply something is owed. */}
          {bill.status === "paid_off_open" && (
            <span style={{ color: "var(--success)" }}> · paid off, nothing owed</span>
          )}
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-3)", textAlign: "right" }}>
        {ordinalDay(bill.due_day)}
      </div>
      <div>
        <Badge tone={paid ? "paid" : "warning"}>{paid ? "Paid" : "Unpaid"}</Badge>
      </div>
      <div
        style={{ textAlign: "right" }}
        onClick={(e) => e.stopPropagation()}
      >
        {editing ? (
          <Input
            prefix="$"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => { setEditing(false); onAmount(Number(val) || 0); }}
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer" }}
          >
            <Amount value={record?.amount_paid ?? bill.amount} size="md" muted={!paid} />
          </button>
        )}
      </div>
      <div
        style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Escape hatch for a charge the bank already took — offered on hover so
            it doesn't clutter every row. Auto-pay bills skip the deduction on
            their own, so they don't need it. */}
        {!paid && deducts && payFromOn && hover && (
          <Button variant="ghost" size="sm" onClick={onPaidNoDeduct}
                  title="Mark paid without deducting from your balance">
            No deduct
          </Button>
        )}
        <Button variant={paid ? "secondary" : "primary"} size="sm" onClick={onToggle}
                title={!deducts && payFromOn ? "Records the payment; your balance isn't touched" : undefined}>
          {paid ? "Undo" : "Mark paid"}
        </Button>
      </div>
    </div>
  );
}
