import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, photoUrl } from "@/lib/api";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, EmptyState, Modal, Field, Input, Switch, Badge, Textarea, Select,
} from "@/components/ui";

type Project = {
  id: number; customer: string | null; name: string; hourly_rate: number;
  is_active: boolean; notes: string | null;
  crm_opportunity_id?: number | null; crm_synced_at?: string | null;
  total_hours?: number; total_billed?: number; uninvoiced?: number; unpaid?: number; entry_count?: number;
};
type Entry = {
  id: number; project_id: number; year: number; month: number; hours: number;
  note: string | null; invoiced: boolean; paid: boolean; amount: number;
  amount_override: number | null; source: string; crm_ref: string | null;
  logged_as_income: boolean;
};
type CrmEngagement = {
  crm_opportunity_id: number; name: string; customer: string | null; business: string | null;
  hourly_rate: number; total_hours: number; total_amount: number;
  periods: { year: number; month: number; hours: number; amount: number; invoiced: boolean;
             paid: boolean; invoice_number: string | null; invoice_status: string | null; source: string }[];
  linked_project: { id: number; name: string } | null;
  suggested_project: { id: number; name: string } | null;
};
type CrmSettings = { base_url: string; has_key: boolean };
type Summary = {
  project_count: number; active_count: number; total_hours: number;
  total_billed: number; uninvoiced: number; unpaid: number;
  year: number; billed_ytd: number; collected_ytd: number;
  expenses_total: number; expenses_ytd: number; net_ytd: number;
  expenses_by_category_ytd: { category: string; total: number }[];
  tax_rate_pct: number; est_tax_ytd: number;
};
type Expense = {
  id: number; incurred_on: string; vendor: string | null; description: string | null;
  amount: number; category: string; project_id: number | null; project_name: string | null;
  contractor_id: number | null; contractor_name: string | null;
  has_receipt: boolean; receipt_mime: string | null;
};
type Contractor = {
  id: number; name: string; contact: string | null; notes: string | null;
  w9_on_file: boolean; is_active: boolean;
  payment_count: number; paid_total: number; paid_ytd: number;
  threshold_1099: number; needs_1099: boolean;
};

const EXPENSE_CATEGORIES = [
  "Software", "Hardware", "Hosting", "Supplies", "Contract Labor", "Mileage",
  "Travel", "Meals", "Fees", "Marketing", "Education", "Other",
];

// IRS standard mileage rate (2026). Update yearly.
const IRS_MILE_RATE = 0.70;

// Federal 1040-ES due dates; returns the next one from today.
function nextEstTaxDeadline(): string {
  const now = new Date();
  const y = now.getFullYear();
  const dates = [
    new Date(y, 3, 15), new Date(y, 5, 15), new Date(y, 8, 15), new Date(y + 1, 0, 15),
  ];
  const next = dates.find((d) => d >= now) ?? dates[dates.length - 1];
  return next.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function monthLabel(m: number) {
  return new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0",
                  fontWeight: bold ? 700 : 400, color: bold ? "var(--fg-1)" : "var(--fg-2)" }}>
      <span>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)" }}>
        {value < 0 ? `-$${fmtMoney(Math.abs(value))}` : `$${fmtMoney(value)}`}
      </span>
    </div>
  );
}
function nowYM() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function Business() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);
  const [tab, setTab] = useState<"overview" | "billing" | "expenses" | "contractors">("overview");
  const [crmOpen, setCrmOpen] = useState(false);

  async function load() {
    const [p, s, x, c] = await Promise.all([
      api.get<Project[]>("/business/projects"),
      api.get<Summary>("/business/summary"),
      api.get<Expense[]>("/business/expenses"),
      api.get<Contractor[]>("/business/contractors"),
    ]);
    setProjects(p);
    setSummary(s);
    setExpenses(x);
    setContractors(c);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveProject(form: any) {
    const payload = { ...form, hourly_rate: Number(form.hourly_rate) || 0 };
    if (form.id) await api.put(`/business/projects/${form.id}`, payload);
    else await api.post("/business/projects", payload);
    setEditingProject(null);
    load();
  }
  async function removeProject(p: Project) {
    if (!confirm(`Delete project "${p.name}" and all its work entries?`)) return;
    await api.del(`/business/projects/${p.id}`);
    load();
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Business</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Projects, hours, invoices, and expenses — for your side work.
          </p>
        </div>
        {tab === "billing" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button icon="RefreshCw" variant="secondary" onClick={() => setCrmOpen(true)}>Sync from CRM</Button>
            <Button icon="Plus" onClick={() => setEditingProject({ is_active: true, hourly_rate: 0 })}>Add project</Button>
          </div>
        )}
        {tab === "overview" && (
          <Button icon="Download" variant="secondary"
                  onClick={() => api.downloadPost("/business/export", { year: new Date().getFullYear() },
                                                  `business-${new Date().getFullYear()}.csv`)}>
            Export CSV
          </Button>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border-subtle)" }}>
        {([["overview", "Overview"], ["billing", "Billing"], ["expenses", "Expenses"], ["contractors", "Contract Labor"]] as const).map(([key, label]) => (
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

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : tab === "overview" ? (
        <OverviewSection summary={summary} expenses={expenses} projects={projects} goTo={setTab} onRefresh={load} />
      ) : tab === "expenses" ? (
        <ExpensesSection expenses={expenses} projects={projects} contractors={contractors} onChanged={load} />
      ) : tab === "contractors" ? (
        <ContractorsSection contractors={contractors} expenses={expenses} projects={projects} onChanged={load} />
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet."
            body="Add a project for a customer with your hourly rate, then log hours each month to invoice."
            icon="Briefcase"
            action={<Button icon="Plus" onClick={() => setEditingProject({ is_active: true, hourly_rate: 0 })}>Add project</Button>}
          />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onChanged={load}
                         onEdit={() => setEditingProject(p)} onDelete={() => removeProject(p)} />
          ))}
        </div>
      )}

      {editingProject && (
        <ProjectEditor initial={editingProject} onClose={() => setEditingProject(null)} onSave={saveProject} />
      )}
      {crmOpen && (
        <CrmSyncModal projects={projects} onClose={() => setCrmOpen(false)} onChanged={load} />
      )}
    </>
  );
}

/** Links Hearth projects to CRM engagements and pulls their billing periods in.
 *  Also holds the CRM connection settings, since that's the only place they matter. */
function CrmSyncModal({ projects, onClose, onChanged }: {
  projects: Project[]; onClose: () => void; onChanged: () => void;
}) {
  const [settings, setSettings] = useState<CrmSettings | null>(null);
  const [engagements, setEngagements] = useState<CrmEngagement[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");

  async function loadEngagements(s?: CrmSettings) {
    const current = s ?? settings;
    if (current && !current.has_key) { setShowSetup(true); return; }
    setError(null);
    try {
      const data = await api.get<{ engagements: CrmEngagement[] }>("/business/crm/engagements");
      setEngagements(data.engagements);
    } catch (e: any) {
      setEngagements(null);
      setError({ code: e?.payload?.error, message: e?.payload?.message || e?.message || "Couldn't reach the CRM." });
      setShowSetup(true);
    }
  }

  useEffect(() => {
    (async () => {
      const s = await api.get<CrmSettings>("/business/crm/settings");
      setSettings(s);
      setUrl(s.base_url);
      await loadEngagements(s);
    })();
    // eslint-disable-next-line
  }, []);

  async function saveSetup() {
    setBusy(true);
    try {
      const body: any = { base_url: url };
      if (key.trim()) body.api_key = key.trim();
      const s = await api.put<CrmSettings>("/business/crm/settings", body);
      setSettings(s); setKey(""); setShowSetup(false);
      await loadEngagements(s);
    } finally { setBusy(false); }
  }

  async function linkTo(eng: CrmEngagement, value: string) {
    setBusy(true);
    try {
      if (value === "__new__") {
        await api.put("/business/crm/link", { crm_opportunity_id: eng.crm_opportunity_id, create: true });
      } else {
        await api.put("/business/crm/link", {
          crm_opportunity_id: eng.crm_opportunity_id,
          project_id: value === "" ? null : Number(value),
        });
      }
      await loadEngagements();
      onChanged();
    } finally { setBusy(false); }
  }

  async function runSync() {
    setBusy(true); setError(null);
    try {
      setResult(await api.post("/business/crm/sync"));
      await loadEngagements();
      onChanged();
    } catch (e: any) {
      setError({ code: e?.payload?.error, message: e?.payload?.message || e?.message || "Sync failed." });
    } finally { setBusy(false); }
  }

  const linkedCount = (engagements ?? []).filter((e) => e.linked_project).length;

  return (
    <Modal open onClose={onClose} title="Sync billing from the CRM" width={760}
      footer={
        <>
          <Button variant="ghost" onClick={() => setShowSetup((v) => !v)}>
            {showSetup ? "Hide connection" : "Connection"}
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" icon="RefreshCw" loading={busy}
                  disabled={linkedCount === 0} onClick={runSync}>
            Sync {linkedCount > 0 ? `${linkedCount} project${linkedCount !== 1 ? "s" : ""}` : ""}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)" }}>
          Hours, amounts, notes, and invoiced status are pulled from the CRM for every linked project.
          A month you've already marked paid stays paid.
        </p>

        {showSetup && (
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="CRM address">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:5000" />
              </Field>
              <Field label={settings?.has_key ? "API key (saved — type to replace)" : "API key"}>
                <Input value={key} type="password" onChange={(e) => setKey(e.target.value)}
                       placeholder={settings?.has_key ? "••••••••" : "Paste the CRM key"} />
              </Field>
              <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                Get the key from the CRM: <code>flask crm-api-key</code> in <code>sales-crm/</code>.
              </div>
              <div><Button variant="primary" loading={busy} onClick={saveSetup}>Save & connect</Button></div>
            </div>
          </Card>
        )}

        {error && (
          <Card style={{ borderColor: "var(--danger)" }}>
            <div style={{ fontSize: 13, color: "var(--danger)" }}>{error.message}</div>
          </Card>
        )}

        {result && (
          <Card>
            <div style={{ fontSize: 13, color: "var(--fg-1)" }}>
              Synced — {result.created} added, {result.updated} updated, {result.unchanged} already current.
            </div>
            {(result.missing ?? []).length > 0 && (
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 6 }}>
                No longer in the CRM: {result.missing.map((m: any) => m.project).join(", ")}
              </div>
            )}
          </Card>
        )}

        {engagements === null ? (
          !showSetup && <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spinner /></div>
        ) : engagements.length === 0 ? (
          <EmptyState title="No hourly engagements in the CRM yet." icon="Briefcase" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {engagements.map((eng) => (
              <Card key={eng.crm_opportunity_id} padding={16}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>{eng.name}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
                      {eng.customer ?? "No customer"} · ${fmtMoney(eng.hourly_rate)}/hr · {eng.total_hours} hrs
                      {" · "}{eng.periods.length} period{eng.periods.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--fg-1)" }}>
                    ${fmtMoney(eng.total_amount)}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--fg-3)", whiteSpace: "nowrap" }}>Hearth project</span>
                  <Select
                    value={eng.linked_project ? String(eng.linked_project.id) : ""}
                    onChange={(e) => linkTo(eng, e.target.value)}
                  >
                    <option value="">Not linked — skip</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    <option value="__new__">+ Create a new project</option>
                  </Select>
                  {!eng.linked_project && eng.suggested_project && (
                    <Button variant="ghost" size="sm"
                            onClick={() => linkTo(eng, String(eng.suggested_project!.id))}>
                      Use “{eng.suggested_project.name}”
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function OverviewSection({ summary, expenses, projects, goTo, onRefresh }: {
  summary: Summary | null; expenses: Expense[]; projects: Project[];
  goTo: (t: "overview" | "billing" | "expenses") => void;
  onRefresh: () => void;
}) {
  if (!summary) return null;
  const recent = expenses.slice(0, 6);
  const activeProjects = projects.filter((p) => p.is_active);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
        <Card><Eyebrow>Billed (all time)</Eyebrow><div style={{ marginTop: 10 }}><Amount value={summary.total_billed} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>{summary.total_hours.toLocaleString()} hrs</div></Card>
        <Card><Eyebrow>Not yet invoiced</Eyebrow><div style={{ marginTop: 10 }}><Amount value={summary.uninvoiced} size="lg" /></div></Card>
        <Card style={{ borderColor: summary.unpaid > 0 ? "var(--warning)" : undefined } as any}>
          <Eyebrow>Outstanding (unpaid)</Eyebrow><div style={{ marginTop: 10 }}><Amount value={summary.unpaid} size="lg" /></div></Card>
        <Card><Eyebrow>Expenses ({summary.year})</Eyebrow><div style={{ marginTop: 10 }}><Amount value={summary.expenses_ytd} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>${fmtMoney(summary.expenses_total)} all time</div></Card>
        <Card style={{ borderColor: summary.net_ytd < 0 ? "var(--warning)" : "var(--success)" } as any}>
          <Eyebrow>Net profit ({summary.year})</Eyebrow><div style={{ marginTop: 10 }}><Amount value={summary.net_ytd} size="lg" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>collected − expenses, cash basis</div></Card>
        <Card><Eyebrow>Active projects</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 26, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>{summary.active_count}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            {activeProjects.slice(0, 3).map((p) => p.name).join(" · ") || "none"}
          </div></Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Eyebrow>This year</Eyebrow>
            <Button variant="ghost" size="sm" onClick={() => goTo("billing")}>Billing →</Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <Row label="Billed" value={summary.billed_ytd} />
            <Row label="Collected" value={summary.collected_ytd} />
            <Row label="Expenses" value={-summary.expenses_ytd} />
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 8 }}>
              <Row label="Net (cash)" value={summary.net_ytd} bold />
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Eyebrow>Expenses by category ({summary.year})</Eyebrow>
            <Button variant="ghost" size="sm" onClick={() => goTo("expenses")}>Expenses →</Button>
          </div>
          {summary.expenses_by_category_ytd.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--fg-3)" }}>Nothing logged yet this year.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {summary.expenses_by_category_ytd.map((c) => (
                <Row key={c.category} label={c.category} value={c.total} />
              ))}
            </div>
          )}
        </Card>
        <EstimatedTaxCard summary={summary} onChanged={onRefresh} />
      </div>

      <Card padding={0}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <Eyebrow>Recent expenses</Eyebrow>
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: "var(--fg-3)" }}>
            No expenses yet — log software, hardware, mileage, fees on the Expenses tab.
          </div>
        ) : recent.map((x) => (
          <div key={x.id} style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 110px", gap: 16, alignItems: "center", padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>
            <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{fmtDate(x.incurred_on)}</span>
            <span style={{ color: "var(--fg-1)" }}>{x.vendor || x.description || "—"}</span>
            <Badge tone="neutral">{x.category}</Badge>
            <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>${fmtMoney(x.amount)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function EstimatedTaxCard({ summary, onChanged }: { summary: Summary; onChanged: () => void }) {
  const [editingRate, setEditingRate] = useState(false);
  const [rate, setRate] = useState(String(summary.tax_rate_pct));

  async function saveRate() {
    const pct = Number(rate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 60) return;
    await api.post("/business/tax-rate", { pct });
    setEditingRate(false);
    onChanged();
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Eyebrow>Estimated taxes ({summary.year})</Eyebrow>
        {editingRate ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 64 }}>
              <Input inputMode="decimal" value={rate} containerStyle={{ height: 28 }} style={{ textAlign: "right" }}
                     onChange={(e) => setRate(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") saveRate(); if (e.key === "Escape") setEditingRate(false); }} />
            </div>
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>%</span>
            <Button variant="ghost" size="sm" icon="Check" onClick={saveRate}>{""}</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => { setRate(String(summary.tax_rate_pct)); setEditingRate(true); }}>
            {summary.tax_rate_pct}% rate
          </Button>
        )}
      </div>
      <div style={{ marginTop: 2 }}><Amount value={summary.est_tax_ytd} size="lg" /></div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>
        {summary.net_ytd <= 0
          ? "No net profit yet this year — nothing owed."
          : <>Set aside from ${fmtMoney(summary.net_ytd)} net · next 1040-ES due <strong style={{ color: "var(--fg-2)" }}>{nextEstTaxDeadline()}</strong></>}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-4)" }}>
        Rough planning number (net × your rate) — not tax advice.
      </div>
    </Card>
  );
}

function ExpensesSection({ expenses, projects, contractors, onChanged }: {
  expenses: Expense[]; projects: Project[]; contractors: Contractor[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<number | null>(null);

  const year = new Date().getFullYear();
  const ytd = expenses.filter((x) => x.incurred_on?.startsWith(String(year)));
  const ytdTotal = ytd.reduce((s, x) => s + x.amount, 0);

  async function remove(x: Expense) {
    if (!confirm(`Delete this expense${x.vendor ? ` (${x.vendor})` : ""}? Its receipt goes too.`)) return;
    await api.del(`/business/expenses/${x.id}`);
    onChanged();
  }
  async function attachReceipt(file: File) {
    if (uploadTarget == null) return;
    try {
      await api.upload(`/business/expenses/${uploadTarget}/receipt`, file);
      onChanged();
    } catch (e: any) {
      alert(e?.payload?.message || "Couldn't upload that receipt.");
    } finally { setUploadTarget(null); }
  }

  const grid = "96px 1fr 130px 150px 110px 100px 64px";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Eyebrow>Expenses</Eyebrow>
          <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
            · {ytd.length} this year · ${fmtMoney(ytdTotal)} YTD
          </span>
        </div>
        <Button icon="Plus" onClick={() => setEditing({})}>Add expense</Button>
      </div>

      <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) attachReceipt(f); e.currentTarget.value = ""; }} />

      {expenses.length === 0 ? (
        <Card>
          <EmptyState
            title="No expenses yet."
            body="Track software, hardware, mileage, travel, fees — attach the receipt so everything for taxes lives here."
            icon="ReceiptText"
            action={<Button icon="Plus" onClick={() => setEditing({})}>Add expense</Button>}
          />
        </Card>
      ) : (
        <Card padding={0}>
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 16, padding: "12px 20px",
                        borderBottom: "1px solid var(--border-subtle)", fontSize: 11, fontWeight: 600,
                        color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <span>Date</span><span>Vendor / description</span><span>Category</span>
            <span>Project</span><span style={{ textAlign: "right" }}>Amount</span>
            <span style={{ textAlign: "center" }}>Receipt</span><span></span>
          </div>
          {expenses.map((x) => (
            <div key={x.id} style={{ display: "grid", gridTemplateColumns: grid, gap: 16, alignItems: "center",
                                     padding: "12px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)" }}>{fmtDate(x.incurred_on)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>{x.vendor || "—"}</div>
                {x.description && (
                  <div style={{ fontSize: 12, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {x.description}
                  </div>
                )}
              </div>
              <div><Badge tone="neutral">{x.category}</Badge></div>
              <span style={{ fontSize: 12, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {x.project_name || <span style={{ color: "var(--fg-4)" }}>—</span>}
              </span>
              <div style={{ textAlign: "right" }}><Amount value={x.amount} size="md" /></div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {x.has_receipt ? (
                  <Button variant="ghost" size="sm" icon="Eye" title="View receipt"
                          onClick={() => window.open(photoUrl(`/business/expenses/${x.id}/receipt`), "_blank")}>{""}</Button>
                ) : (
                  <Button variant="ghost" size="sm" icon="Paperclip" title="Attach receipt"
                          onClick={() => { setUploadTarget(x.id); fileRef.current?.click(); }}>{""}</Button>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                <Button variant="ghost" size="sm" icon="Pencil" onClick={() => setEditing(x)}>{""}</Button>
                <Button variant="ghost" size="sm" icon="Trash2" onClick={() => remove(x)}>{""}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {editing && (
        <ExpenseEditor initial={editing} projects={projects} contractors={contractors}
                       onClose={() => setEditing(null)}
                       onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </div>
  );
}

function ExpenseEditor({ initial, projects, contractors, onClose, onSaved }: {
  initial: Partial<Expense>; projects: Project[]; contractors: Contractor[];
  onClose: () => void; onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({
    incurred_on: initial.incurred_on ?? today,
    vendor: initial.vendor ?? "",
    description: initial.description ?? "",
    amount: initial.amount != null ? String(initial.amount) : "",
    category: initial.category ?? "Software",
    project_id: initial.project_id ?? "",
    contractor_id: initial.contractor_id ?? "",
    id: initial.id,
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      const payload = {
        incurred_on: form.incurred_on,
        vendor: form.vendor || null,
        description: form.description || null,
        amount: Number(form.amount) || 0,
        category: form.category || "Other",
        project_id: form.project_id === "" ? null : Number(form.project_id),
        contractor_id: form.contractor_id === "" ? null : Number(form.contractor_id),
      };
      let id = form.id as number | undefined;
      if (id) await api.put(`/business/expenses/${id}`, payload);
      else id = (await api.post<Expense>("/business/expenses", payload)).id;
      if (removeReceipt && id && !receipt) await api.del(`/business/expenses/${id}/receipt`);
      if (receipt && id) await api.upload(`/business/expenses/${id}/receipt`, receipt);
      onSaved();
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't save the expense.");
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={form.id ? "Edit expense" : "Add expense"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!Number(form.amount)}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Date">
            <Input type="date" value={form.incurred_on} onChange={(e) => setForm({ ...form, incurred_on: e.target.value })} />
          </Field>
          <Field label="Amount">
            <Input prefix="$" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="49.99" />
          </Field>
        </div>
        {form.category === "Mileage" && (
          <Field label={`Miles driven (× $${IRS_MILE_RATE.toFixed(2)}/mi IRS rate)`}>
            <Input
              inputMode="decimal" value={form.miles ?? ""} placeholder="e.g. 42"
              onChange={(e) => {
                const mi = Number(e.target.value) || 0;
                setForm({
                  ...form, miles: e.target.value,
                  amount: mi > 0 ? (mi * IRS_MILE_RATE).toFixed(2) : form.amount,
                  description: form.description && !/^\d+(\.\d+)? mi @/.test(form.description)
                    ? form.description
                    : mi > 0 ? `${e.target.value} mi @ $${IRS_MILE_RATE.toFixed(2)}/mi` : form.description,
                });
              }}
            />
          </Field>
        )}
        <Field label="Vendor">
          <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Anthropic, Home Depot, BP" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Category">
            <Input list="biz-expense-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="biz-expense-cats">
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Project (optional)">
            <Select value={String(form.project_id)} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">— none —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {contractors.length > 0 && (
          <Field label="Contractor (optional — links this payment to their 1099 total)">
            <Select value={String(form.contractor_id)} onChange={(e) => {
              const cid = e.target.value;
              const c = contractors.find((k) => String(k.id) === cid);
              setForm({
                ...form, contractor_id: cid,
                category: cid ? "Contract Labor" : form.category,
                vendor: cid && !form.vendor ? (c?.name ?? "") : form.vendor,
              });
            }}>
              <option value="">— none —</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Description (optional)">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="what it was for" />
        </Field>
        <div>
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 6 }}>Receipt</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) { setReceipt(f); setRemoveReceipt(false); } e.currentTarget.value = ""; }} />
            <Button variant="secondary" size="sm" icon="Paperclip" onClick={() => fileRef.current?.click()}>
              {receipt ? receipt.name.slice(0, 28) : initial.has_receipt && !removeReceipt ? "Replace receipt" : "Attach receipt"}
            </Button>
            {initial.has_receipt && !receipt && !removeReceipt && (
              <>
                <Button variant="ghost" size="sm" icon="Eye"
                        onClick={() => window.open(photoUrl(`/business/expenses/${initial.id}/receipt`), "_blank")}>View</Button>
                <Button variant="ghost" size="sm" onClick={() => setRemoveReceipt(true)}>Remove</Button>
              </>
            )}
            {receipt && <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}>Clear</Button>}
            {removeReceipt && <span style={{ fontSize: 12, color: "var(--warning)" }}>will be removed on save</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Photo or PDF, under 10 MB.</div>
        </div>
        {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
      </div>
    </Modal>
  );
}

function ContractorsSection({ contractors, expenses, projects, onChanged }: {
  contractors: Contractor[]; expenses: Expense[]; projects: Project[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Partial<Contractor> | null>(null);
  const [paying, setPaying] = useState<Partial<Expense> | null>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [showGuide, setShowGuide] = useState(contractors.length === 0);

  function toggleOpen(id: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function setW9(c: Contractor, v: boolean) {
    await api.put(`/business/contractors/${c.id}`, { w9_on_file: v });
    onChanged();
  }
  async function remove(c: Contractor) {
    if (!confirm(`Delete contractor "${c.name}"? Their logged payments stay as expenses.`)) return;
    await api.del(`/business/contractors/${c.id}`);
    onChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Eyebrow>Subcontractors</Eyebrow>
          <Button variant="ghost" size="sm" onClick={() => setShowGuide((s) => !s)}>
            {showGuide ? "Hide checklist" : "New contractor checklist"}
          </Button>
        </div>
        <Button icon="Plus" onClick={() => setEditing({ is_active: true })}>Add contractor</Button>
      </div>

      {showGuide && (
        <Card style={{ background: "var(--surface-inset)" } as any}>
          <Eyebrow>Before and after you pay a sub</Eyebrow>
          <ol style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.9 }}>
            <li><strong>Collect a W-9 before the first payment</strong> — name, address, TIN. Flip the "W-9 on file" switch here once you have it.</li>
            <li><strong>They invoice you; you pay the invoice.</strong> Log it as a payment on this tab (or as a Contract Labor expense) and attach their invoice as the receipt — it's your deduction.</li>
            <li><strong>1099-NEC by Jan 31</strong> if you paid them ${fmtMoney(2000)}+ during the year (threshold for payments made 2026 onward). The card below tracks each contractor's YTD toward it.</li>
            <li><strong>Keep them a contractor:</strong> they control how and when the work gets done, use their own tools, and can work for others. Directing daily work like an employee changes the relationship — and the taxes.</li>
            <li><strong>No payroll taxes for you</strong> — they pay their own SE tax on what you paid them. Your deduction is the invoice amount, nothing more.</li>
          </ol>
        </Card>
      )}

      {contractors.length === 0 ? (
        <Card>
          <EmptyState
            title="No contractors yet."
            body="Add a subcontractor to track their W-9, payments, and whether you owe them a 1099-NEC in January."
            icon="Users"
            action={<Button icon="Plus" onClick={() => setEditing({ is_active: true })}>Add contractor</Button>}
          />
        </Card>
      ) : contractors.map((c) => {
        const open = openIds.has(c.id);
        const payments = expenses.filter((x) => x.contractor_id === c.id);
        return (
          <Card key={c.id} padding={0} style={{ opacity: c.is_active ? 1 : 0.65 }}>
            <div
              onClick={() => toggleOpen(c.id)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                       padding: "16px 24px", cursor: "pointer", userSelect: "none",
                       borderBottom: open ? "1px solid var(--border-subtle)" : "none" }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", color: "var(--fg-3)" }}>
                    {open ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>{c.name}</span>
                  {!c.is_active && <Badge tone="neutral">Inactive</Badge>}
                  {c.w9_on_file
                    ? <Badge tone="success">W-9 on file</Badge>
                    : <Badge tone="warning">W-9 missing</Badge>}
                  {c.needs_1099 && (
                    <Badge tone={c.w9_on_file ? "neutral" : "warning"}>1099-NEC due Jan 31</Badge>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 2, marginLeft: 24 }}>
                  {c.contact || "no contact info"}{c.notes ? ` · ${c.notes}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--fg-1)" }}>${fmtMoney(c.paid_ytd)}</div>
                  <div style={{ fontSize: 11, color: c.needs_1099 ? "var(--warning)" : "var(--fg-3)" }}>
                    YTD · {c.needs_1099
                      ? "over 1099 threshold"
                      : `$${fmtMoney(Math.max(0, c.threshold_1099 - c.paid_ytd))} to 1099 threshold`}
                  </div>
                </div>
                <Button variant="ghost" size="sm" icon="Banknote" title="Log a payment"
                        onClick={(e: any) => { e.stopPropagation(); setPaying({ contractor_id: c.id, category: "Contract Labor", vendor: c.name }); }}>{""}</Button>
                <Button variant="ghost" size="sm" icon="Pencil" onClick={(e: any) => { e.stopPropagation(); setEditing(c); }}>{""}</Button>
                <Button variant="ghost" size="sm" icon="Trash2" onClick={(e: any) => { e.stopPropagation(); remove(c); }}>{""}</Button>
              </div>
            </div>
            {open && (
              <div style={{ padding: "10px 24px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)" }}
                         onClick={(e) => e.stopPropagation()}>
                    <Switch on={c.w9_on_file} onChange={(v) => setW9(c, v)} /> W-9 on file
                  </label>
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    ${fmtMoney(c.paid_total)} all time · {c.payment_count} payment{c.payment_count !== 1 ? "s" : ""}
                  </span>
                </div>
                {payments.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--fg-3)", padding: "4px 0 8px" }}>
                    No payments logged yet.
                  </div>
                ) : payments.map((x) => (
                  <div key={x.id} style={{ display: "grid", gridTemplateColumns: "96px 1fr 130px 110px 60px", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border-subtle)", fontSize: 13 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)" }}>{fmtDate(x.incurred_on)}</span>
                    <span style={{ color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {x.description || x.category}{x.project_name ? ` · ${x.project_name}` : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                      {x.has_receipt ? "invoice attached" : "no invoice"}
                    </span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>${fmtMoney(x.amount)}</span>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      {x.has_receipt && (
                        <Button variant="ghost" size="sm" icon="Eye" title="View invoice"
                                onClick={() => window.open(photoUrl(`/business/expenses/${x.id}/receipt`), "_blank")}>{""}</Button>
                      )}
                      <Button variant="ghost" size="sm" icon="Pencil" onClick={() => setPaying(x)}>{""}</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {editing && (
        <ContractorEditor initial={editing} onClose={() => setEditing(null)}
                          onSaved={() => { setEditing(null); onChanged(); }} />
      )}
      {paying && (
        <ExpenseEditor initial={paying} projects={projects} contractors={contractors}
                       onClose={() => setPaying(null)}
                       onSaved={() => { setPaying(null); onChanged(); }} />
      )}
    </div>
  );
}

function ContractorEditor({ initial, onClose, onSaved }: {
  initial: Partial<Contractor>; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<any>({
    name: initial.name ?? "", contact: initial.contact ?? "", notes: initial.notes ?? "",
    w9_on_file: initial.w9_on_file ?? false, is_active: initial.is_active ?? true, id: initial.id,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      if (form.id) await api.put(`/business/contractors/${form.id}`, form);
      else await api.post("/business/contractors", form);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={form.id ? "Edit contractor" : "Add contractor"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jane Doe / Doe Design LLC" />
        </Field>
        <Field label="Contact (optional)">
          <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="email or phone" />
        </Field>
        <Field label="Notes (optional)">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="what they do, rate, etc." />
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)" }}>
          <Switch on={!!form.w9_on_file} onChange={(v) => setForm({ ...form, w9_on_file: v })} /> W-9 on file
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)" }}>
          <Switch on={!!form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} /> Active
        </label>
      </div>
    </Modal>
  );
}

function ProjectCard({ project, onChanged, onEdit, onDelete }: {
  project: Project; onChanged: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryModal, setEntryModal] = useState<{ entry?: Entry } | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  const [open, setOpen] = useState(false);

  async function loadEntries() {
    setEntries(await api.get<Entry[]>(`/business/projects/${project.id}/entries`));
  }
  useEffect(() => { loadEntries(); /* eslint-disable-next-line */ }, [project.id]);

  async function toggle(e: Entry, field: "invoiced" | "paid", value: boolean) {
    await api.put(`/business/entries/${e.id}`, { [field]: value });
    await loadEntries();
    onChanged();
  }
  async function saveEntry(form: any) {
    const payload = {
      year: form.year, month: form.month,
      hours: Number(form.hours) || 0, note: form.note || null,
      invoiced: !!form.invoiced, paid: !!form.paid,
    };
    if (form.id) await api.put(`/business/entries/${form.id}`, payload);
    else await api.post(`/business/projects/${project.id}/entries`, payload);
    setEntryModal(null);
    await loadEntries();
    onChanged();
  }
  async function removeEntry(e: Entry) {
    if (!confirm(`Delete the ${monthLabel(e.month)} ${e.year} entry?`)) return;
    await api.del(`/business/entries/${e.id}`);
    await loadEntries();
    onChanged();
  }

  const grid = "96px 64px 110px 84px 84px 1fr 60px";

  return (
    <Card padding={0} style={{ opacity: project.is_active ? 1 : 0.65 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                 padding: "18px 24px", cursor: "pointer", userSelect: "none",
                 borderBottom: open ? "1px solid var(--border-subtle)" : "none" }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", color: "var(--fg-3)" }}>
              {open ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)" }}>{project.name}</span>
            {!project.is_active && <Badge tone="neutral">Inactive</Badge>}
            {project.crm_opportunity_id && (
              <span title={project.crm_synced_at
                ? `Synced from the CRM ${fmtDate(project.crm_synced_at)}`
                : "Linked to the CRM — not synced yet"}>
                <Badge tone="info">CRM</Badge>
              </span>
            )}
            {entries.length > 0 && !open && (
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>· {entries.length} month{entries.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 2, marginLeft: 24 }}>
            {project.customer ? `${project.customer} · ` : ""}${fmtMoney(project.hourly_rate)}/hr
            {project.notes ? ` · ${project.notes}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--fg-1)" }}>${fmtMoney(project.total_billed ?? 0)}</div>
            <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
              {(project.unpaid ?? 0) > 0 ? `${`$${fmtMoney(project.unpaid ?? 0)}`} unpaid` : "all paid"}
            </div>
          </div>
          <Button variant="ghost" size="sm" icon="FileText" onClick={(e: any) => { e.stopPropagation(); setInvoicing(true); }} disabled={entries.length === 0} title="Create invoice">{""}</Button>
          <Button variant="ghost" size="sm" icon="Pencil" onClick={(e: any) => { e.stopPropagation(); onEdit(); }}>{""}</Button>
          <Button variant="ghost" size="sm" icon="Trash2" onClick={(e: any) => { e.stopPropagation(); onDelete(); }}>{""}</Button>
        </div>
      </div>

      {open && <div style={{ padding: "8px 24px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
          <div>
            <Eyebrow>Monthly work</Eyebrow>
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
              Marking a month paid also logs it to your income.
            </div>
          </div>
          <Button variant="secondary" size="sm" icon="Plus" onClick={() => setEntryModal({})}>Log month</Button>
        </div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--fg-3)", padding: "4px 0 8px" }}>
            No hours logged yet. Log a month to start invoicing.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: grid, gap: 12, padding: "6px 0", fontSize: 11, fontWeight: 600, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span>Month</span><span style={{ textAlign: "right" }}>Hours</span><span style={{ textAlign: "right" }}>Amount</span>
              <span style={{ textAlign: "center" }}>Invoiced</span><span style={{ textAlign: "center" }}>Paid</span><span>Note</span><span></span>
            </div>
            {entries.map((e) => (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: grid, gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border-subtle)", fontSize: 13 }}>
                <span style={{ color: "var(--fg-1)" }}>{monthLabel(e.month)} {e.year}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>{e.hours}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>
                  ${fmtMoney(e.amount)}
                  {e.logged_as_income && <span title="Logged to your income" style={{ color: "var(--success)", marginLeft: 4 }}>↳</span>}
                </span>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Switch on={e.invoiced} onChange={(v) => toggle(e, "invoiced", v)} />
                </div>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Switch on={e.paid} onChange={(v) => toggle(e, "paid", v)} />
                </div>
                <span style={{ color: "var(--fg-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note || ""}</span>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                  <Button variant="ghost" size="sm" icon="Pencil" onClick={() => setEntryModal({ entry: e })}>{""}</Button>
                  <Button variant="ghost" size="sm" icon="Trash2" onClick={() => removeEntry(e)}>{""}</Button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>}

      {entryModal && (
        <EntryEditor project={project} initial={entryModal.entry} onClose={() => setEntryModal(null)} onSave={saveEntry} />
      )}
      {invoicing && (
        <InvoiceModal project={project} entries={entries} onClose={() => setInvoicing(false)}
                      onDone={() => { setInvoicing(false); loadEntries(); onChanged(); }} />
      )}
    </Card>
  );
}

function InvoiceModal({ project, entries, onClose, onDone }: {
  project: Project; entries: Entry[]; onClose: () => void; onDone: () => void;
}) {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [fromText, setFromText] = useState("");
  const [billTo, setBillTo] = useState(project.customer ?? "");
  const [number, setNumber] = useState(`${project.id}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`);
  const [date, setDate] = useState(iso(today));
  const [due, setDue] = useState(iso(new Date(today.getTime() + 14 * 864e5)));
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [payTo, setPayTo] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [markInvoiced, setMarkInvoiced] = useState(true);
  const logoRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<number[]>(() => {
    const unbilled = entries.filter((e) => !e.invoiced).map((e) => e.id);
    return unbilled.length ? unbilled : entries.map((e) => e.id);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ from_text: string; logo: string | null; pay_to: string }>("/business/profile")
      .then((r) => { setFromText(r.from_text || ""); setLogo(r.logo || null); setPayTo(r.pay_to || ""); }).catch(() => {});
  }, []);

  async function uploadLogo(file: File) {
    setError(null);
    try {
      const r = await api.upload<{ logo: string }>("/business/logo", file);
      setLogo(r.logo);
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't upload that image.");
    }
  }
  async function removeLogo() {
    await api.del("/business/logo").catch(() => {});
    setLogo(null);
  }

  const subtotal = entries.filter((e) => selected.includes(e.id)).reduce((s, e) => s + e.amount, 0);
  const disc = Math.max(0, Number(discount) || 0);
  const taxable = Math.max(0, subtotal - disc);
  const tax = taxable * (Number(taxRate) || 0) / 100;
  const grandTotal = taxable + tax;
  function toggle(id: number) {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  async function download() {
    if (selected.length === 0) { setError("Pick at least one month."); return; }
    setBusy(true); setError(null);
    try {
      await api.downloadPost(`/business/projects/${project.id}/invoice`, {
        entry_ids: selected, from_text: fromText, bill_to: billTo,
        number, date, due, notes, pay_to: payTo,
        discount: Number(discount) || 0, tax_rate: Number(taxRate) || 0,
        mark_invoiced: markInvoiced,
      }, `invoice-${number}.pdf`);
      onDone();
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't generate the invoice.");
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} width={560} title={`Invoice — ${project.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={download} loading={busy} icon="Download">Download PDF</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 6 }}>Logo</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logo
              ? <img src={logo} alt="logo" style={{ height: 40, maxWidth: 160, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 4 }} />
              : <div style={{ fontSize: 12, color: "var(--fg-3)" }}>No logo yet.</div>}
            <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }}
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.currentTarget.value = ""; }} />
            <Button variant="secondary" size="sm" icon="Upload" onClick={() => logoRef.current?.click()}>{logo ? "Replace" : "Upload logo"}</Button>
            {logo && <Button variant="ghost" size="sm" onClick={removeLogo}>Remove</Button>}
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>PNG/JPG, under 2 MB. Appears at the top of every invoice.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="From (you)" hint="remembered for next time">
            <Textarea value={fromText} onChange={(e) => setFromText(e.target.value)} rows={3} placeholder={"Your name\nBusiness LLC\nemail"} />
          </Field>
          <Field label="Bill to">
            <Textarea value={billTo} onChange={(e) => setBillTo(e.target.value)} rows={3} placeholder={"Customer name\nAttn / address"} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Invoice #"><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 6 }}>Months to include</div>
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
            {entries.map((e) => (
              <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} />
                <span style={{ flex: 1 }}>{monthLabel(e.month)} {e.year} · {e.hours} hrs{e.invoiced ? " · already invoiced" : ""}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>${fmtMoney(e.amount)}</span>
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Discount ($, optional)"><Input prefix="$" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
          <Field label="Tax rate (%, optional)"><Input inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0" /></Field>
        </div>
        <div style={{ marginLeft: "auto", width: 240, fontSize: 13, color: "var(--fg-2)" }}>
          <Row label="Subtotal" value={subtotal} />
          {disc > 0 && <Row label="Discount" value={-disc} />}
          {tax > 0 && <Row label={`Tax (${Number(taxRate) || 0}%)`} value={tax} />}
          <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 4, paddingTop: 4 }}>
            <Row label="Total due" value={grandTotal} bold />
          </div>
        </div>
        <Field label="Payment instructions (optional)" hint="remembered — e.g. Venmo @you, Zelle, bank details">
          <Textarea value={payTo} onChange={(e) => setPayTo(e.target.value)} rows={2} placeholder={"Venmo @yourhandle\nor Zelle: you@email.com"} />
        </Field>
        <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Thank-you, terms, etc." /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)" }}>
          <Switch on={markInvoiced} onChange={setMarkInvoiced} /> Mark these months as invoiced
        </label>
        {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
      </div>
    </Modal>
  );
}

function ProjectEditor({ initial, onClose, onSave }: { initial: Partial<Project>; onClose: () => void; onSave: (f: any) => void }) {
  const [form, setForm] = useState<any>({ ...initial });
  return (
    <Modal open onClose={onClose} title={initial.id ? "Edit project" : "Add project"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(form)} disabled={!form.name}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Project name"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Website rebuild" /></Field>
          <Field label="Customer"><Input value={form.customer ?? ""} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="e.g. Acme LLC" /></Field>
        </div>
        <Field label="Hourly rate"><Input prefix="$" inputMode="decimal" value={form.hourly_rate ?? ""} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} placeholder="85" /></Field>
        <Field label="Notes (optional)"><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="scope, contacts, etc." /></Field>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Switch on={form.is_active ?? true} onChange={(v) => setForm({ ...form, is_active: v })} />
          <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Active {form.is_active ?? true ? "" : "(hidden from totals focus)"}</span>
        </div>
      </div>
    </Modal>
  );
}

function EntryEditor({ project, initial, onClose, onSave }: { project: Project; initial?: Entry; onClose: () => void; onSave: (f: any) => void }) {
  const init = initial ?? { ...nowYM(), hours: "", note: "", invoiced: false, paid: false } as any;
  const [form, setForm] = useState<any>({ ...init, hours: initial ? String(initial.hours) : "" });
  const period = `${form.year}-${String(form.month).padStart(2, "0")}`;
  const amount = (Number(form.hours) || 0) * project.hourly_rate;

  return (
    <Modal open onClose={onClose} title={initial ? "Edit month" : `Log a month — ${project.name}`}
      subtitle={`Billed at $${fmtMoney(project.hourly_rate)}/hr`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave({ ...form, hours: Number(form.hours) || 0 })}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Month">
            <Input type="month" value={period} onChange={(e) => {
              const [y, m] = e.target.value.split("-");
              setForm({ ...form, year: Number(y), month: Number(m) });
            }} />
          </Field>
          <Field label="Hours worked"><Input inputMode="decimal" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="12.5" /></Field>
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
          Invoice amount: <strong style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>${fmtMoney(amount)}</strong>
        </div>
        <Field label="What was done"><Textarea value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} placeholder="e.g. Built checkout flow, fixed 3 bugs, client call" /></Field>
        <div style={{ display: "flex", gap: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)" }}>
            <Switch on={!!form.invoiced} onChange={(v) => setForm({ ...form, invoiced: v })} /> Invoiced
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)" }}>
            <Switch on={!!form.paid} onChange={(v) => setForm({ ...form, paid: v })} /> Paid
          </label>
        </div>
      </div>
    </Modal>
  );
}
