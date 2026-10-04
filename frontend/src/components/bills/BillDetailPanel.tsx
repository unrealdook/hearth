import { useEffect, useState } from "react";
import { X, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { fmtMoney, ordinalDay } from "@/lib/format";
import {
  Button, VendorIcon, Amount, Eyebrow, Field, Input, Badge,
} from "@/components/ui";
import type { Bill } from "@/types/bill";

type Props = {
  bill: Bill;
  onClose: () => void;
  onPaid: () => void;
  onEdit: () => void;
};

// Bills whose pay slide-out should offer a usage reading, with a default unit.
const METERED_UNIT: Record<string, string> = {
  electric: "kWh", gas: "therm", water: "gal", internet: "GB", phone: "GB",
};

export function BillDetailPanel({ bill, onClose, onPaid, onEdit }: Props) {
  const [credentials, setCredentials] = useState<{ username: string | null; password: string | null } | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [amount, setAmount] = useState(String(bill.amount));
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [usage, setUsage] = useState("");
  const [unit, setUnit] = useState(bill.usage_unit ?? METERED_UNIT[bill.kind] ?? "");
  const [paidInfo, setPaidInfo] = useState<{ pay_from?: { account_name: string; new_balance: number; deducted: number; skipped?: boolean }; usage_logged?: { usage: number; unit: string | null } } | null>(null);
  // Offer the usage field for metered utilities, or any bill already set to track it.
  const showUsage = bill.usage_unit != null || bill.kind in METERED_UNIT;

  useEffect(() => {
    api.get(`/payments?bill_id=${bill.id}`).then(setHistory).catch(() => setHistory([]));
  }, [bill.id]);

  async function reveal() {
    if (credentials) { setCredentials(null); setShowPw(false); return; }
    setRevealing(true);
    try {
      const r = await api.get<{ username: string | null; password: string | null }>(`/credentials/${bill.id}`);
      setCredentials(r);
    } finally { setRevealing(false); }
  }

  async function pay() {
    setBusy(true);
    try {
      const body: any = { bill_id: bill.id, amount_paid: Number(amount), paid: true };
      if (showUsage && usage.trim() !== "") {
        body.usage = Number(usage);
        body.usage_unit = unit.trim() || null;  // remembered on the bill for next time
      }
      const r = await api.post<any>("/payments", body);
      // Keep the panel open to confirm a deduction and/or a logged reading;
      // otherwise close + refresh as before.
      if (r?.pay_from?.account_id != null || r?.usage_logged) {
        setPaidInfo({ pay_from: r.pay_from ?? undefined, usage_logged: r.usage_logged ?? undefined });
      } else {
        onPaid();
      }
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 90,
        animation: "hearth-fade-in var(--dur-state) var(--ease)",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "95vw",
          background: "var(--surface-1)",
          borderLeft: "1px solid var(--border-default)",
          padding: 28,
          overflowY: "auto",
          animation: "hearth-slide-in var(--dur-state) var(--ease)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <VendorIcon kind={bill.kind} size={48} />
          <div style={{ display: "flex", gap: 4 }}>
            <Button variant="ghost" size="sm" onClick={onEdit} icon="Pencil">{""}</Button>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: "transparent", border: "none", color: "var(--fg-2)", padding: 8, borderRadius: "var(--r-md)", display: "inline-flex" }}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>{bill.name}</div>
        <div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 4 }}>{bill.category}</div>

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
          <Eyebrow>Pay</Eyebrow>
          {paidInfo ? (
            <div style={{
              marginTop: 12, padding: "14px 16px", borderRadius: "var(--r-md)",
              background: "var(--surface-inset)",
              border: `1px solid ${paidInfo.pay_from && paidInfo.pay_from.new_balance < 0 ? "var(--danger)" : "var(--success)"}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>Paid.</div>
              {paidInfo.pay_from && (
                paidInfo.pay_from.skipped ? (
                  <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg-2)" }}>
                    Recorded only — {paidInfo.pay_from.account_name} is unchanged at ${fmtMoney(paidInfo.pay_from.new_balance)},
                    since this one comes out on its own.
                  </div>
                ) : (
                  <div style={{ marginTop: 4, fontSize: 13, color: paidInfo.pay_from.new_balance < 0 ? "var(--danger)" : "var(--fg-2)" }}>
                    ${fmtMoney(paidInfo.pay_from.deducted)} from {paidInfo.pay_from.account_name} · now ${fmtMoney(paidInfo.pay_from.new_balance)}
                    {paidInfo.pay_from.new_balance < 0 ? " — below zero, move money in to cover it." : "."}
                  </div>
                )
              )}
              {paidInfo.usage_logged && (
                <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg-2)" }}>
                  Logged {paidInfo.usage_logged.usage.toLocaleString()} {paidInfo.usage_logged.unit || ""} to your usage trend.
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <Button variant="primary" size="md" onClick={onPaid} icon="Check">Done</Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Amount this time">
                <Input prefix="$" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {showUsage && (
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Field label="Usage this month" style={{ flex: 2 }}>
                      <Input value={usage} onChange={(e) => setUsage(e.target.value)} inputMode="decimal" placeholder="e.g. 71" />
                    </Field>
                    <Field label="Unit" style={{ flex: 1 }}>
                      <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="therm, gal…" />
                    </Field>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-3)" }}>
                    Optional — logs to your usage trend.
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {bill.payment_url && (
                  <a href={bill.payment_url} target="_blank" rel="noreferrer">
                    <Button variant="secondary" size="md" icon="ExternalLink">Open biller</Button>
                  </a>
                )}
                <Button variant="primary" size="md" onClick={pay} loading={busy} icon="Check">
                  Mark as paid
                </Button>
              </div>
            </div>
          )}
        </div>

        {bill.has_credentials && (
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Eyebrow>Credentials</Eyebrow>
              <Button variant="ghost" size="sm" onClick={reveal} loading={revealing}>
                {credentials ? "Hide" : "Reveal"}
              </Button>
            </div>
            {credentials ? (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <CopyRow label="Username" value={credentials.username || "—"} />
                <CopyRow
                  label="Password"
                  value={credentials.password || "—"}
                  masked={!showPw}
                  onToggle={() => setShowPw((v) => !v)}
                />
              </div>
            ) : (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--fg-3)" }}>
                Stored encrypted with your passcode.
              </div>
            )}
          </div>
        )}

        {bill.balance_remaining != null && (
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
            <Eyebrow>Amount left</Eyebrow>
            <div style={{ marginTop: 8 }}>
              <Amount value={bill.balance_remaining} size="xl" />
            </div>
            {bill.amount > 0 && (
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--fg-2)" }}>
                ~{Math.ceil(bill.balance_remaining / bill.amount)} months at ${fmtMoney(bill.amount)}/mo
              </div>
            )}
          </div>
        )}

        <PayoffSection bill={bill} onChanged={onPaid} />

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
          <Eyebrow>Details</Eyebrow>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <DetailRow label="Default amount" value={`$${fmtMoney(bill.amount)}`} />
            <DetailRow label="Due day" value={ordinalDay(bill.due_day)} />
            <DetailRow label="Auto-pay" value={bill.is_autopay ? "On" : "Off"} />
            {bill.credit_limit != null && <DetailRow label="Credit limit" value={`$${fmtMoney(bill.credit_limit)}`} />}
            {bill.term_months != null && <DetailRow label="Term" value={`${bill.term_months} months`} />}
            {bill.notes && <DetailRow label="Notes" value={bill.notes} multiline />}
          </div>
        </div>

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
          <Eyebrow>Recent payments</Eyebrow>
          <div style={{ marginTop: 12 }}>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--fg-3)" }}>No payments recorded yet.</div>
            ) : (
              history.slice(0, 10).map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: i < Math.min(history.length, 10) - 1 ? "1px solid var(--border-subtle)" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: "var(--fg-1)" }}>
                      {p.year}–{String(p.month).padStart(2, "0")}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
                      {p.paid ? `Paid${p.paid_date ? ` · ${new Date(p.paid_date).toLocaleDateString()}` : ""}` : "Unpaid"}
                    </div>
                  </div>
                  <Amount value={p.amount_paid} size="sm" muted={!p.paid} />
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: 13, gap: 16 }}>
      <span style={{ color: "var(--fg-3)", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: "var(--fg-1)",
          fontWeight: 500,
          textAlign: "right",
          whiteSpace: multiline ? "pre-wrap" : "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CopyRow({
  label, value, masked, onToggle,
}: { label: string; value: string; masked?: boolean; onToggle?: () => void }) {
  const [copied, setCopied] = useState(false);
  const show = !masked;
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: "var(--r-md)",
        background: "var(--surface-inset)",
        border: "1px solid var(--border-subtle)",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-1)", marginTop: 2 }}>
          {show ? value : "•".repeat(Math.max(8, value.length))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {onToggle && (
          <Button variant="ghost" size="sm" onClick={onToggle} aria-label={show ? "Hide" : "Show"}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
        )}
        <Button variant={copied ? "secondary" : "ghost"} size="sm" onClick={copy} icon={copied ? "Check" : "Copy"}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}


/** Mark a bill paid off — and choose whether that also retires it.
 *
 *  Two outcomes, because "paid off" means different things:
 *   - a finished loan should never be billed again (close it out)
 *   - a credit card you just zeroed is still a live account (keep it)
 */
function PayoffSection({ bill, onChanged }: { bill: Bill; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [debt, setDebt] = useState<{ id: number; name: string; debt_amount: number } | null>(null);
  const [clearDebt, setClearDebt] = useState(true);
  const paidOff = bill.status === "paid_off" || bill.status === "paid_off_open";

  async function expand() {
    setOpen(true);
    try {
      const r = await api.get<{ matching_debt: typeof debt }>(`/bills/${bill.id}/payoff-preview`);
      setDebt(r.matching_debt);
    } catch { setDebt(null); }
  }

  async function mark(close: boolean) {
    setBusy(close ? "close" : "keep");
    try {
      await api.post(`/bills/${bill.id}/paid-off`, {
        close,
        clear_debt: close && !!debt && clearDebt,
      });
      onChanged();
    } finally { setBusy(null); }
  }

  async function undo() {
    setBusy("undo");
    try {
      await api.del(`/bills/${bill.id}/paid-off`);
      onChanged();
    } finally { setBusy(null); }
  }

  return (
    <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
      <Eyebrow>Payoff</Eyebrow>

      {paidOff ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge tone="paid">Paid off</Badge>
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>
              {bill.paid_off_on ? new Date(bill.paid_off_on + "T00:00:00").toLocaleDateString() : ""}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            {bill.status === "paid_off"
              ? "Closed out — it won't appear in upcoming bills, the monthly total, or the forecast."
              : "Still active, so it keeps showing up each month. The badge clears on its own once a new balance appears."}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button variant="ghost" size="sm" icon="RotateCcw" loading={busy === "undo"} onClick={undo}>
              Undo payoff
            </Button>
          </div>
        </div>
      ) : !open ? (
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" size="sm" icon="CircleCheck" onClick={expand}>Mark paid off</Button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {debt && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12,
                            color: "var(--fg-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={clearDebt} onChange={(e) => setClearDebt(e.target.checked)}
                     style={{ marginTop: 2 }} />
              <span>
                Also clear the matching <strong>{debt.name}</strong> debt
                (${fmtMoney(debt.debt_amount)}) so it leaves your net worth and payoff plan.
              </span>
            </label>
          )}

          <Button variant="primary" size="md" loading={busy === "close"} onClick={() => mark(true)}>
            Paid off — close it out
          </Button>
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: -4 }}>
            For something that's finished, like a loan. Stops it appearing in future payments.
          </div>

          <Button variant="secondary" size="md" loading={busy === "keep"} onClick={() => mark(false)}>
            Paid off — keep it active
          </Button>
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: -4 }}>
            For something you'll use again, like a credit card. Zeroes the balance but keeps billing it.
          </div>

          <div><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}
