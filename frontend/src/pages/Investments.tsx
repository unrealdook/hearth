import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, EmptyState, Modal, Field, Input, Textarea, Select,
} from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";

type Retirement = {
  id: number; name: string; balance: number;
  contribution_pct: number; employer_match_pct: number; projected_growth_pct: number;
};

type PaycheckYtd = {
  amount: number;          // employee + employer combined
  employee: number;
  employerMatch: number;
  sources: string[];
};

type Investment = {
  id: number; name: string; asset_type: string; symbol: string | null;
  balance: number; notes: string | null;
};

type Contribution = {
  id: number; account_kind: "retirement_401k" | "investment"; account_id: number;
  occurred_on: string; amount: number; note: string | null;
};

type Income = {
  id: number; source: string; amount: number; frequency: string; type: string;
  gross_amount?: number | null;
  retirement_401k_amount?: number | null;
  paycheck_retirement_account_id?: number | null;
};

const FREQ_PER_YEAR: Record<string, number> = {
  monthly: 12, biweekly: 26, per_check: 26, semimonthly: 24, weekly: 52, annual: 1,
};

function ytdFractionOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const elapsed = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  return Math.min(1, elapsed / 365);
}

const ASSET_TYPES: { value: string; label: string }[] = [
  { value: "roth_ira",        label: "Roth IRA" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "stock",           label: "Individual stock" },
  { value: "brokerage",       label: "Taxable brokerage" },
  { value: "reit",            label: "Real estate / REIT" },
  { value: "managed",         label: "Managed account" },
  { value: "cash_eq",         label: "Cash equivalent" },
  { value: "real_estate",     label: "Real estate (direct)" },
];

function assetTypeLabel(v: string): string {
  return ASSET_TYPES.find((t) => t.value === v)?.label ?? v;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type AccountTarget = { kind: "retirement_401k"; account: Retirement } | { kind: "investment"; account: Investment };

export function Investments() {
  const [retirement, setRetirement] = useState<Retirement[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRet, setEditingRet] = useState<Partial<Retirement> | null>(null);
  const [editingInv, setEditingInv] = useState<Partial<Investment> | null>(null);
  const [addContribFor, setAddContribFor] = useState<AccountTarget | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  async function load() {
    setLoading(true);
    try {
      const [r, i, c, inc] = await Promise.all([
        api.get<Retirement[]>("/savings/retirement"),
        api.get<Investment[]>("/savings/investments"),
        api.get<Contribution[]>(`/savings/contributions?year=${currentYear}`),
        api.get<Income[]>("/income"),
      ]);
      setRetirement(r); setInvestments(i); setContribs(c); setIncomes(inc);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Auto-computed 401(k) contributions inferred from paycheck breakdowns on income
  // sources. Per source: per_check × per_year × (fraction of year elapsed).
  // Employer match comes from the linked Retirement401k account's employer_match_pct
  // applied to the income's gross_amount (match isn't a paycheck deduction).
  const paycheck401kByAccount = useMemo(() => {
    const fraction = ytdFractionOfYear();
    const m = new Map<number | "unattributed", PaycheckYtd>();
    const retById = new Map(retirement.map((r) => [r.id, r]));
    for (const i of incomes) {
      const employeePerCheck = Number(i.retirement_401k_amount) || 0;
      const gross = Number(i.gross_amount) || 0;
      const linkedId = i.paycheck_retirement_account_id ?? null;
      const matchPct = linkedId ? Number(retById.get(linkedId)?.employer_match_pct) || 0 : 0;
      const matchPerCheck = gross * (matchPct / 100);
      if (employeePerCheck <= 0 && matchPerCheck <= 0) continue;
      const perYear = FREQ_PER_YEAR[i.frequency] ?? 12;
      const employeeYtd = employeePerCheck * perYear * fraction;
      const matchYtd = matchPerCheck * perYear * fraction;
      const key = linkedId ?? "unattributed";
      const cur = m.get(key) ?? { amount: 0, employee: 0, employerMatch: 0, sources: [] };
      cur.amount += employeeYtd + matchYtd;
      cur.employee += employeeYtd;
      cur.employerMatch += matchYtd;
      cur.sources.push(i.source);
      m.set(key, cur);
    }
    return m;
  }, [incomes, retirement]);

  const paycheck401kTotal = useMemo(() => {
    let s = 0;
    paycheck401kByAccount.forEach((v) => { s += v.amount; });
    return s;
  }, [paycheck401kByAccount]);

  const paycheckSplit = useMemo(() => {
    let employee = 0, employerMatch = 0;
    paycheck401kByAccount.forEach((v) => {
      employee += v.employee;
      employerMatch += v.employerMatch;
    });
    return { employee, employerMatch };
  }, [paycheck401kByAccount]);

  const totals = useMemo(() => {
    const ret = retirement.reduce((s, r) => s + (r.balance || 0), 0);
    const inv = investments.reduce((s, i) => s + (i.balance || 0), 0);
    const ytdLogged = contribs.reduce((s, c) => s + (c.amount || 0), 0);
    const ytd = ytdLogged + paycheck401kTotal;
    return {
      ret, inv, ytd, ytdLogged,
      ytdPaycheck: paycheck401kTotal,
      ytdEmployee: paycheckSplit.employee,
      ytdEmployerMatch: paycheckSplit.employerMatch,
      balance: ret + inv,
    };
  }, [retirement, investments, contribs, paycheck401kTotal, paycheckSplit]);

  const contribByKey = useMemo(() => {
    const m = new Map<string, Contribution[]>();
    for (const c of contribs) {
      const key = `${c.account_kind}:${c.account_id}`;
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return m;
  }, [contribs]);

  async function saveRet(form: Partial<Retirement>) {
    const payload: any = { ...form };
    for (const k of ["balance", "contribution_pct", "employer_match_pct", "projected_growth_pct"]) {
      if (payload[k] !== undefined && payload[k] !== "") payload[k] = Number(payload[k]) || 0;
    }
    if (form.id) await api.put(`/savings/retirement/${form.id}`, payload);
    else await api.post("/savings/retirement", payload);
    setEditingRet(null);
    load();
  }

  async function saveInv(form: Partial<Investment>) {
    const payload: any = { ...form, balance: Number(form.balance) || 0 };
    if (form.id) await api.put(`/savings/investments/${form.id}`, payload);
    else await api.post("/savings/investments", payload);
    setEditingInv(null);
    load();
  }

  async function deleteRet(r: Retirement) {
    if (!confirm(`Remove ${r.name}? Contribution history will also be removed.`)) return;
    await api.del(`/savings/retirement/${r.id}`);
    load();
  }
  async function deleteInv(i: Investment) {
    if (!confirm(`Remove ${i.name}? Contribution history will also be removed.`)) return;
    await api.del(`/savings/investments/${i.id}`);
    load();
  }

  async function saveContrib(target: AccountTarget, payload: Partial<Contribution>) {
    await api.post("/savings/contributions", {
      account_kind: target.kind,
      account_id: target.account.id,
      ...payload,
    });
    setAddContribFor(null);
    load();
  }

  async function deleteContrib(id: number) {
    if (!confirm("Remove this contribution?")) return;
    await api.del(`/savings/contributions/${id}`);
    load();
  }

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Investments</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Retirement, IRAs, brokerage. Log contributions so you can see what went in this year.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        <Card>
          <Eyebrow>Total balance</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.balance} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>everything below</div>
        </Card>
        <Card>
          <Eyebrow>Retirement</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.ret} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{retirement.length} {retirement.length === 1 ? "account" : "accounts"}</div>
        </Card>
        <Card>
          <Eyebrow>Investments</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.inv} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{investments.length} {investments.length === 1 ? "account" : "accounts"}</div>
        </Card>
        <Card>
          <Eyebrow>YTD contributed</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.ytd} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{currentYear}</div>
          {totals.ytdPaycheck > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-subtle)",
                          display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--fg-3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>your 401(k)</span>
                <Amount value={totals.ytdEmployee} size="sm" muted />
              </div>
              {totals.ytdEmployerMatch > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>employer match</span>
                  <Amount value={totals.ytdEmployerMatch} size="sm" muted />
                </div>
              )}
              {totals.ytdLogged > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>logged deposits</span>
                  <Amount value={totals.ytdLogged} size="sm" muted />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <AccountSection
        title="Retirement (401k)"
        emptyTitle="No retirement accounts yet."
        onAdd={() => setEditingRet({ name: "401k" })}
      >
        {retirement.map((r) => {
          const key = `retirement_401k:${r.id}`;
          const expanded = expandedKey === key;
          const rows = contribByKey.get(key) ?? [];
          const logged = rows.reduce((s, c) => s + (c.amount || 0), 0);
          const paycheck = paycheck401kByAccount.get(r.id);
          const paycheckYtd = paycheck?.amount ?? 0;
          return (
            <AccountRow
              key={key}
              expanded={expanded}
              onToggle={() => setExpandedKey(expanded ? null : key)}
              name={r.name}
              subtitle={`${r.contribution_pct}% you · ${r.employer_match_pct}% match`}
              balance={r.balance}
              ytdContrib={logged + paycheckYtd}
              rowCount={rows.length}
              onEdit={() => setEditingRet(r)}
              onDelete={() => deleteRet(r)}
              onAddContrib={() => setAddContribFor({ kind: "retirement_401k", account: r })}
              contributions={rows}
              onDeleteContrib={deleteContrib}
              currentYear={currentYear}
              paycheckYtd={paycheckYtd}
              paycheckEmployee={paycheck?.employee ?? 0}
              paycheckEmployerMatch={paycheck?.employerMatch ?? 0}
              paycheckSources={paycheck?.sources ?? []}
            />
          );
        })}
        {/* Unattributed paycheck 401k — when a paycheck has a 401k amount but no linked account */}
        {(paycheck401kByAccount.get("unattributed")?.amount ?? 0) > 0 && (
          <div style={{
            padding: "12px 20px", borderTop: "1px solid var(--border-subtle)",
            background: "var(--surface-inset)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: 12, color: "var(--fg-3)",
          }}>
            <div>
              <span style={{ color: "var(--warning)" }}>⚠</span> Unattributed paycheck 401(k):
              <span style={{ marginLeft: 6 }}>
                {paycheck401kByAccount.get("unattributed")?.sources.join(", ")}
              </span>
              <span style={{ marginLeft: 8 }}>
                — link this source's 401(k) deduction to an account in the Income editor.
              </span>
            </div>
            <Amount value={paycheck401kByAccount.get("unattributed")?.amount ?? 0} size="sm" muted />
          </div>
        )}
      </AccountSection>

      <div style={{ height: 32 }} />

      <AccountSection
        title="IRAs, brokerage, individual stocks"
        emptyTitle="No investment accounts yet."
        onAdd={() => setEditingInv({ asset_type: "roth_ira", balance: 0 })}
      >
        {investments.map((i) => {
          const key = `investment:${i.id}`;
          const expanded = expandedKey === key;
          const rows = contribByKey.get(key) ?? [];
          const ytd = rows.reduce((s, c) => s + (c.amount || 0), 0);
          return (
            <AccountRow
              key={key}
              expanded={expanded}
              onToggle={() => setExpandedKey(expanded ? null : key)}
              name={i.name}
              subtitle={[assetTypeLabel(i.asset_type), i.symbol].filter(Boolean).join(" · ")}
              balance={i.balance}
              ytdContrib={ytd}
              rowCount={rows.length}
              onEdit={() => setEditingInv(i)}
              onDelete={() => deleteInv(i)}
              onAddContrib={() => setAddContribFor({ kind: "investment", account: i })}
              contributions={rows}
              onDeleteContrib={deleteContrib}
              currentYear={currentYear}
            />
          );
        })}
      </AccountSection>

      {editingRet && (
        <RetirementEditor initial={editingRet} onClose={() => setEditingRet(null)} onSave={saveRet} />
      )}
      {editingInv && (
        <InvestmentEditor initial={editingInv} onClose={() => setEditingInv(null)} onSave={saveInv} />
      )}
      {addContribFor && (
        <ContributionEditor
          target={addContribFor}
          onClose={() => setAddContribFor(null)}
          onSave={(payload) => saveContrib(addContribFor, payload)}
        />
      )}
    </>
  );
}

function AccountSection({
  title, emptyTitle, onAdd, children,
}: { title: string; emptyTitle: string; onAdd: () => void; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const empty = arr.filter(Boolean).length === 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Eyebrow>{title}</Eyebrow>
        <Button variant="ghost" size="sm" icon="Plus" onClick={onAdd}>Add account</Button>
      </div>
      {empty ? (
        <Card><EmptyState title={emptyTitle} icon="PiggyBank" action={<Button icon="Plus" onClick={onAdd}>Add account</Button>} /></Card>
      ) : (
        <Card padding={0}>{children}</Card>
      )}
    </div>
  );
}

function AccountRow({
  expanded, onToggle, name, subtitle, balance, ytdContrib, rowCount,
  onEdit, onDelete, onAddContrib, contributions, onDeleteContrib, currentYear,
  paycheckYtd = 0, paycheckEmployee = 0, paycheckEmployerMatch = 0, paycheckSources = [],
}: {
  expanded: boolean; onToggle: () => void;
  name: string; subtitle: string; balance: number; ytdContrib: number; rowCount: number;
  onEdit: () => void; onDelete: () => void; onAddContrib: () => void;
  contributions: Contribution[]; onDeleteContrib: (id: number) => void;
  currentYear: number;
  paycheckYtd?: number;
  paycheckEmployee?: number;
  paycheckEmployerMatch?: number;
  paycheckSources?: string[];
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr 160px 140px 80px",
          gap: 16,
          alignItems: "center",
          padding: "14px 20px",
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          icon={expanded ? "ChevronDown" : "ChevronRight"}
          onClick={onToggle}
          style={{ padding: 4, width: 28, height: 28 }}
        >{""}</Button>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            <Private strength={9}>{name}</Private>
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{subtitle}</div>
          )}
          {ytdContrib > 0 && (
            <div style={{ marginTop: 2, fontSize: 11, color: "var(--fg-3)" }}>
              + <Private strength={6}>${fmtMoney(ytdContrib)}</Private> YTD ({rowCount})
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", textAlign: "right" }}>balance</div>
        <div style={{ textAlign: "right" }}><Amount value={balance} size="md" /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
          <Button variant="ghost" size="sm" icon="Pencil" onClick={onEdit}>{""}</Button>
          <Button variant="ghost" size="sm" icon="Trash2" onClick={onDelete}>{""}</Button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 20px 16px 64px", background: "var(--surface-inset)" }}>
          {paycheckYtd > 0 && (
            <div style={{ padding: "12px 0 4px" }}>
              <Eyebrow>Auto from paychecks (estimated)</Eyebrow>
              <div style={{
                marginTop: 6, padding: "10px 12px", background: "var(--surface-1)",
                border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)",
                fontSize: 13,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ color: "var(--fg-2)" }}>
                    {paycheckSources.join(", ") || "Linked payroll"}
                  </div>
                  <Amount value={paycheckYtd} size="sm" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Yours</span>
                    <Amount value={paycheckEmployee} size="sm" muted />
                  </div>
                  {paycheckEmployerMatch > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Employer match</span>
                      <Amount value={paycheckEmployerMatch} size="sm" muted />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0 8px" }}>
            <Eyebrow>Manual contributions ({currentYear})</Eyebrow>
            <Button variant="secondary" size="sm" icon="Plus" onClick={onAddContrib}>Add contribution</Button>
          </div>
          {contributions.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--fg-3)", padding: "8px 0" }}>
              {paycheckYtd > 0 ? "No additional manual contributions logged." : "No contributions logged this year. Add one to start the YTD count."}
            </div>
          ) : (
            <div>
              {contributions.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr 100px 32px",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 0",
                    borderTop: "1px solid var(--border-subtle)",
                    fontSize: 13,
                  }}
                >
                  <div style={{ color: "var(--fg-2)" }}>{fmtDate(c.occurred_on)}</div>
                  <div style={{ color: "var(--fg-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.note || ""}
                  </div>
                  <div style={{ textAlign: "right" }}><Amount value={c.amount} size="sm" /></div>
                  <Button variant="ghost" size="sm" icon="Trash2" onClick={() => onDeleteContrib(c.id)}
                          style={{ padding: 4, width: 28, height: 28 }}>{""}</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RetirementEditor({
  initial, onClose, onSave,
}: { initial: Partial<Retirement>; onClose: () => void; onSave: (r: Partial<Retirement>) => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit retirement account" : "Add retirement account"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(form)}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name"><Input value={form.name ?? "401k"} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Current balance"><Input prefix="$" value={form.balance ?? ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Your contribution %" style={{ flex: 1 }}>
            <Input value={form.contribution_pct ?? ""} onChange={(e) => setForm({ ...form, contribution_pct: e.target.value })} />
          </Field>
          <Field label="Employer match %" style={{ flex: 1 }}>
            <Input value={form.employer_match_pct ?? ""} onChange={(e) => setForm({ ...form, employer_match_pct: e.target.value })} />
          </Field>
        </div>
        <Field label="Projected growth %" hint="annual, used for projections">
          <Input value={form.projected_growth_pct ?? ""} onChange={(e) => setForm({ ...form, projected_growth_pct: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function InvestmentEditor({
  initial, onClose, onSave,
}: { initial: Partial<Investment>; onClose: () => void; onSave: (r: Partial<Investment>) => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit investment account" : "Add investment account"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(form)}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fidelity Roth, VOO, etc." /></Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Type" style={{ flex: 1 }}>
            <Select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
              {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Symbol (optional)" style={{ flex: 1 }}>
            <Input value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="VOO" />
          </Field>
        </div>
        <Field label="Current balance"><Input prefix="$" value={form.balance ?? ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} /></Field>
        <Field label="Notes (optional)"><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ContributionEditor({
  target, onClose, onSave,
}: { target: AccountTarget; onClose: () => void; onSave: (p: Partial<Contribution>) => void }) {
  const [form, setForm] = useState<any>({
    occurred_on: todayISO(),
    amount: "",
    note: "",
  });
  const canSave = Number(form.amount) > 0 && !!form.occurred_on;
  return (
    <Modal open onClose={onClose}
      title={`Add contribution to ${target.account.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave({ ...form, amount: Number(form.amount) || 0 })}>Save</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Date" style={{ flex: 1 }}>
            <Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
          </Field>
          <Field label="Amount" style={{ flex: 1 }}>
            <Input prefix="$" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" inputMode="decimal" />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="e.g. paycheck deferral, lump sum, year-end top-up" rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
