import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, EmptyState, Modal, Field, Input, Select, Badge,
} from "@/components/ui";

type Account = { id: number; name: string; balance: number; bucket: string; notes: string | null; is_business?: boolean; sort_order?: number };
type Investment = { id: number; name: string; asset_type: string; symbol: string | null; balance: number };
type Retirement = { id: number; name: string; balance: number; contribution_pct: number; employer_match_pct: number; projected_growth_pct: number };
type Owed = { id: number; person: string; amount: number; notes: string | null };

const ASSET_TYPES = [
  { value: "stock", label: "Stock" },
  { value: "reit", label: "Real estate / REIT" },
  { value: "managed", label: "Managed account" },
  { value: "cash_eq", label: "Cash equivalent" },
  { value: "real_estate", label: "Real estate (direct)" },
];

export function Savings() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [retirement, setRetirement] = useState<Retirement[]>([]);
  const [owed, setOwed] = useState<Owed[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingAccount, setEditingAccount] = useState<Partial<Account> | null>(null);
  const [editingInv, setEditingInv] = useState<Partial<Investment> | null>(null);
  const [editingRet, setEditingRet] = useState<Partial<Retirement> | null>(null);
  const [editingOwed, setEditingOwed] = useState<Partial<Owed> | null>(null);
  const [payFromId, setPayFromId] = useState<number | "">("");

  async function load() {
    setLoading(true);
    try {
      const [a, i, r, o, pf] = await Promise.all([
        api.get<Account[]>("/savings/accounts"),
        api.get<Investment[]>("/savings/investments"),
        api.get<Retirement[]>("/savings/retirement"),
        api.get<Owed[]>("/savings/owed"),
        api.get<{ account_id: number | null }>("/savings/pay-from"),
      ]);
      setAccounts(a); setInvestments(i); setRetirement(r); setOwed(o);
      setPayFromId(pf.account_id ?? "");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function changePayFrom(id: number | "") {
    setPayFromId(id);
    await api.put("/savings/pay-from", { account_id: id === "" ? null : id });
  }

  const cashAccounts = useMemo(() => accounts.filter((a) => a.bucket === "cash" && !a.is_business), [accounts]);

  // Move one account up/down. Optimistic so the row doesn't lag the click.
  async function moveAccount(a: Account, delta: number) {
    const idx = accounts.findIndex((x) => x.id === a.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= accounts.length) return;
    const next = [...accounts];
    [next[idx], next[target]] = [next[target], next[idx]];
    setAccounts(next);
    setAccounts(await api.put<Account[]>("/savings/accounts/reorder", { order: next.map((x) => x.id) }));
  }

  // Inline-edit save handlers (no modal) — coerce numbers, PUT, reload.
  async function saveAccountInline(it: Account, d: any) {
    await api.put(`/savings/accounts/${it.id}`, {
      name: d.name, bucket: d.bucket, balance: Number(d.balance) || 0, notes: d.notes ?? null,
      is_business: d.is_business === "true" || d.is_business === true,
    });
    load();
  }
  async function saveInvestmentInline(it: Investment, d: any) {
    await api.put(`/savings/investments/${it.id}`, {
      name: d.name, symbol: d.symbol || null, asset_type: d.asset_type, balance: Number(d.balance) || 0,
    });
    load();
  }
  async function saveRetirementInline(it: Retirement, d: any) {
    await api.put(`/savings/retirement/${it.id}`, {
      name: d.name, contribution_pct: Number(d.contribution_pct) || 0,
      employer_match_pct: Number(d.employer_match_pct) || 0, balance: Number(d.balance) || 0,
    });
    load();
  }
  async function saveOwedInline(it: Owed, d: any) {
    await api.put(`/savings/owed/${it.id}`, {
      person: d.person, notes: d.notes ?? null, amount: Number(d.amount) || 0,
    });
    load();
  }

  const BUCKETS = [
    { value: "cash", label: "Cash" },
    { value: "savings_bucket", label: "Named savings bucket" },
  ];

  const totals = useMemo(() => {
    const cash = accounts.filter((a) => !a.is_business).reduce((s, a) => s + (a.balance || 0), 0);
    const inv = investments.reduce((s, x) => s + (x.balance || 0), 0);
    const ret = retirement.reduce((s, x) => s + (x.balance || 0), 0);
    const owedTotal = owed.reduce((s, x) => s + (x.amount || 0), 0);
    return { cash, inv, ret, owedTotal, total: cash + inv + ret + owedTotal };
  }, [accounts, investments, retirement, owed]);

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Savings & investments</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>Cash, investments, retirement, and money owed back.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 16, marginBottom: 32 }}>
        <Card><Eyebrow>Cash</Eyebrow><div style={{ marginTop: 12 }}><Amount value={totals.cash} size="lg" /></div></Card>
        <Card><Eyebrow>Investments</Eyebrow><div style={{ marginTop: 12 }}><Amount value={totals.inv} size="lg" /></div></Card>
        <Card><Eyebrow>Retirement</Eyebrow><div style={{ marginTop: 12 }}><Amount value={totals.ret} size="lg" /></div></Card>
        <Card><Eyebrow>Owed to you</Eyebrow><div style={{ marginTop: 12 }}><Amount value={totals.owedTotal} size="lg" /></div></Card>
        <Card><Eyebrow>Total</Eyebrow><div style={{ marginTop: 12 }}><Amount value={totals.total} size="lg" /></div></Card>
      </div>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <Eyebrow>Bills are paid from</Eyebrow>
            <div style={{ marginTop: 4, fontSize: 13, color: "var(--fg-2)" }}>
              When you mark a bill paid, its amount is deducted from this account so your balance stays honest.
              Imported bank transactions don't deduct again.
            </div>
          </div>
          <div style={{ minWidth: 240 }}>
            <Select
              value={String(payFromId)}
              onChange={(e) => changePayFrom(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Don't auto-deduct</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · ${fmtMoney(a.balance)}</option>
              ))}
            </Select>
            {cashAccounts.length === 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
                Add a cash account below to enable this.
              </div>
            )}
          </div>
        </div>
      </Card>

      <Section
        title="Cash & savings"
        items={accounts}
        empty="No cash accounts yet."
        onAdd={() => setEditingAccount({ bucket: "cash", balance: 0 })}
        columns={[
          { key: "name", label: "Name" },
          { key: "bucket", label: "Bucket", edit: { type: "select", options: BUCKETS } },
          {
            key: "is_business", label: "Type",
            edit: { type: "select", options: [{ value: "false", label: "Personal" }, { value: "true", label: "Business" }] },
            render: (v) => v
              ? <Badge tone="info">Business</Badge>
              : <span style={{ color: "var(--fg-4)", fontSize: 13 }}>Personal</span>,
          },
          { key: "balance", label: "Balance", money: true, right: true },
        ]}
        onSave={saveAccountInline}
        onReorder={moveAccount}
        onDelete={async (a) => { if (confirm(`Remove ${a.name}?`)) { await api.del(`/savings/accounts/${a.id}`); load(); } }}
      />

      <div style={{ height: 32 }} />
      <Section
        title="Investments"
        items={investments}
        empty="No investment accounts yet."
        onAdd={() => setEditingInv({ asset_type: "stock", balance: 0 })}
        columns={[
          { key: "name", label: "Name" },
          { key: "symbol", label: "Symbol" },
          { key: "asset_type", label: "Type", edit: { type: "select", options: ASSET_TYPES } },
          { key: "balance", label: "Balance", money: true, right: true },
        ]}
        onSave={saveInvestmentInline}
        onDelete={async (a) => { if (confirm(`Remove ${a.name}?`)) { await api.del(`/savings/investments/${a.id}`); load(); } }}
      />

      <div style={{ height: 32 }} />
      <Section
        title="Retirement (401k)"
        items={retirement}
        empty="No retirement accounts yet."
        onAdd={() => setEditingRet({ name: "401k" })}
        columns={[
          { key: "name", label: "Name" },
          { key: "contribution_pct", label: "Contrib %", edit: { type: "number" } },
          { key: "employer_match_pct", label: "Match %", edit: { type: "number" } },
          { key: "balance", label: "Balance", money: true, right: true },
        ]}
        onSave={saveRetirementInline}
        onDelete={async (a) => { if (confirm(`Remove ${a.name}?`)) { await api.del(`/savings/retirement/${a.id}`); load(); } }}
      />

      <div style={{ height: 32 }} />
      <Section
        title="Owed to you"
        items={owed}
        empty="Nobody owes you, apparently."
        onAdd={() => setEditingOwed({})}
        columns={[
          { key: "person", label: "Person" },
          { key: "notes", label: "Notes" },
          { key: "amount", label: "Amount", money: true, right: true },
        ]}
        onSave={saveOwedInline}
        onDelete={async (a) => { if (confirm(`Remove ${a.person}?`)) { await api.del(`/savings/owed/${a.id}`); load(); } }}
      />

      {editingAccount && (
        <AccountEditor initial={editingAccount} onClose={() => setEditingAccount(null)} onSaved={() => { setEditingAccount(null); load(); }} />
      )}
      {editingInv && (
        <InvestmentEditor initial={editingInv} onClose={() => setEditingInv(null)} onSaved={() => { setEditingInv(null); load(); }} />
      )}
      {editingRet && (
        <RetirementEditor initial={editingRet} onClose={() => setEditingRet(null)} onSaved={() => { setEditingRet(null); load(); }} />
      )}
      {editingOwed && (
        <OwedEditor initial={editingOwed} onClose={() => setEditingOwed(null)} onSaved={() => { setEditingOwed(null); load(); }} />
      )}
    </>
  );
}

type Col = {
  key: string; label: string; money?: boolean; right?: boolean;
  edit?: { type: "text" | "number" | "select"; options?: { value: string; label: string }[] };
  render?: (value: any, item: any) => React.ReactNode;
};

function Section<T extends { id?: number }>({
  title, items, columns, empty, onAdd, onDelete, onSave, onReorder,
}: {
  title: string; items: T[]; columns: Col[]; empty: string;
  onAdd: () => void; onDelete: (t: T) => void;
  onSave?: (item: T, draft: any) => Promise<void> | void;
  /** Supply to show up/down controls. `delta` is -1 (up) or +1 (down). */
  onReorder?: (item: T, delta: number) => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const grid = `${columns.map((c) => c.right ? "150px" : "1fr").join(" ")} ${onReorder ? "140px" : "76px"}`;

  function startEdit(it: any) { setEditingId(it.id); setDraft({ ...it }); }
  function cancel() { setEditingId(null); setDraft({}); }
  async function commit(it: any) {
    if (!onSave) return;
    setBusy(true);
    try { await onSave(it, draft); cancel(); } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Eyebrow>{title}</Eyebrow>
        <Button variant="ghost" size="sm" icon="Plus" onClick={onAdd}>Add</Button>
      </div>
      {items.length === 0 ? (
        <Card><EmptyState title={empty} icon="PiggyBank" /></Card>
      ) : (
        <Card padding={0}>
          <div
            style={{
              display: "grid", gridTemplateColumns: grid, gap: 16, padding: "12px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: 11, fontWeight: 600, color: "var(--fg-3)",
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}
          >
            {columns.map((c) => (
              <span key={c.key} style={{ textAlign: c.right ? "right" : "left" }}>{c.label}</span>
            ))}
            <span></span>
          </div>
          {items.map((it, idx) => {
            const editing = editingId === (it as any).id;
            return (
              <div
                key={it.id}
                style={{
                  display: "grid", gridTemplateColumns: grid, gap: 16, alignItems: "center",
                  padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                {columns.map((c) => {
                  if (editing && onSave) {
                    const t = c.edit?.type ?? (c.money ? "number" : "text");
                    if (t === "select") {
                      return (
                        <Select key={c.key} value={draft[c.key] ?? ""} containerStyle={{ height: 34 }}
                                onChange={(e) => setDraft((d: any) => ({ ...d, [c.key]: e.target.value }))}>
                          {(c.edit?.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      );
                    }
                    return (
                      <Input key={c.key}
                        value={draft[c.key] ?? ""}
                        prefix={c.money ? "$" : undefined}
                        inputMode={t === "number" ? "decimal" : undefined}
                        containerStyle={{ height: 34 }}
                        style={{ textAlign: c.right ? "right" : "left" }}
                        onChange={(e) => setDraft((d: any) => ({ ...d, [c.key]: e.target.value }))}
                      />
                    );
                  }
                  const v = (it as any)[c.key];
                  return (
                    <div key={c.key} style={{ textAlign: c.right ? "right" : "left", fontSize: 14, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.render ? c.render(v, it) : c.money ? <Amount value={Number(v) || 0} size="md" /> : (v ?? "—")}
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                  {editing ? (
                    <>
                      <Button variant="ghost" size="sm" icon="Check" loading={busy} onClick={() => commit(it)}>{""}</Button>
                      <Button variant="ghost" size="sm" icon="X" onClick={cancel}>{""}</Button>
                    </>
                  ) : (
                    <>
                      {onReorder && (
                        <>
                          <Button variant="ghost" size="sm" icon="ChevronUp" title="Move up"
                                  disabled={idx === 0} onClick={() => onReorder(it, -1)}>{""}</Button>
                          <Button variant="ghost" size="sm" icon="ChevronDown" title="Move down"
                                  disabled={idx === items.length - 1} onClick={() => onReorder(it, 1)}>{""}</Button>
                        </>
                      )}
                      {onSave && <Button variant="ghost" size="sm" icon="Pencil" onClick={() => startEdit(it)}>{""}</Button>}
                      <Button variant="ghost" size="sm" icon="Trash2" onClick={() => onDelete(it)}>{""}</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function AccountEditor({ initial, onClose, onSaved }: { initial: Partial<Account>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  async function save() {
    const payload = { ...form, balance: Number(form.balance) || 0 };
    if (form.id) await api.put(`/savings/accounts/${form.id}`, payload);
    else await api.post("/savings/accounts", payload);
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit account" : "Add account"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chase savings" /></Field>
        <Field label="Bucket">
          <Select value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })}>
            <option value="cash">Cash</option>
            <option value="savings_bucket">Named savings bucket</option>
          </Select>
        </Field>
        <Field label="Balance"><Input prefix="$" value={form.balance ?? ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={!!form.is_business}
            onChange={(e) => setForm({ ...form, is_business: e.target.checked })} style={{ cursor: "pointer" }} />
          Business account — exclude from net worth &amp; bill-pay
        </label>
      </div>
    </Modal>
  );
}

function InvestmentEditor({ initial, onClose, onSaved }: { initial: Partial<Investment>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  async function save() {
    const payload = { ...form, balance: Number(form.balance) || 0 };
    if (form.id) await api.put(`/savings/investments/${form.id}`, payload);
    else await api.post("/savings/investments", payload);
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit investment" : "Add investment"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VOO" /></Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Symbol" style={{ flex: 1 }}><Input value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></Field>
          <Field label="Type" style={{ flex: 1 }}>
            <Select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
              {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Balance"><Input prefix="$" value={form.balance ?? ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RetirementEditor({ initial, onClose, onSaved }: { initial: Partial<Retirement>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  async function save() {
    const payload = { ...form };
    for (const k of ["balance", "contribution_pct", "employer_match_pct", "projected_growth_pct"]) {
      if (payload[k] !== undefined && payload[k] !== "") payload[k] = Number(payload[k]) || 0;
    }
    if (form.id) await api.put(`/savings/retirement/${form.id}`, payload);
    else await api.post("/savings/retirement", payload);
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit retirement" : "Add retirement"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name"><Input value={form.name ?? "401k"} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Current balance"><Input prefix="$" value={form.balance ?? ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Your contribution %" style={{ flex: 1 }}><Input value={form.contribution_pct ?? ""} onChange={(e) => setForm({ ...form, contribution_pct: e.target.value })} /></Field>
          <Field label="Employer match %" style={{ flex: 1 }}><Input value={form.employer_match_pct ?? ""} onChange={(e) => setForm({ ...form, employer_match_pct: e.target.value })} /></Field>
        </div>
        <Field label="Projected growth %" hint="annual, used for projections"><Input value={form.projected_growth_pct ?? ""} onChange={(e) => setForm({ ...form, projected_growth_pct: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function OwedEditor({ initial, onClose, onSaved }: { initial: Partial<Owed>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  async function save() {
    const payload = { ...form, amount: Number(form.amount) || 0 };
    if (form.id) await api.put(`/savings/owed/${form.id}`, payload);
    else await api.post("/savings/owed", payload);
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit IOU" : "Add IOU"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Person"><Input value={form.person ?? ""} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="Ash" /></Field>
        <Field label="Amount"><Input prefix="$" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
