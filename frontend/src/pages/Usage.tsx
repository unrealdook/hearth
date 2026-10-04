import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { api } from "@/lib/api";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  Card, Button, Badge, Eyebrow, Spinner, EmptyState, Modal, Field, Input, Select,
} from "@/components/ui";

type Reading = {
  id: number;
  utility_type: string;
  bill_id: number | null;
  period_start: string | null;
  period_end: string | null;
  usage: number | null;
  unit: string | null;
  cost: number;
  cost_per_unit: number | null;
  notes: string | null;
};

type TrendPoint = {
  id: number; period_end: string | null;
  usage: number | null; cost: number; cost_per_unit: number | null;
};
type Trend = {
  utility_type: string; unit: string | null; count: number;
  points: TrendPoint[];
  latest_usage: number | null; avg_usage: number | null;
};

type Decomp = {
  period_end: string; usage_change_pct: number; rate_change_pct: number;
  cost_change: number; usage_effect: number; rate_effect: number;
};
type Insight = {
  utility_type: string; unit: string | null;
  latest: { period_end: string; usage: number; cost: number; rate: number };
  vs_prior: Decomp;
  vs_year_ago?: Decomp;
};

const UTILITY_TYPES = ["electric", "water", "gas", "internet", "trash", "sewer", "phone", "other"];
const TYPE_LABEL: Record<string, string> = {
  electric: "Electric", water: "Water", gas: "Gas", internet: "Internet",
  trash: "Trash", sewer: "Sewer", phone: "Phone", other: "Other",
};
const DEFAULT_UNIT: Record<string, string> = {
  electric: "kWh", water: "gal", gas: "therm", internet: "GB",
  trash: "", sewer: "gal", phone: "GB", other: "",
};

const EMPTY_FORM = {
  utility_type: "electric", period_start: "", period_end: "",
  usage: "", unit: "kWh", cost: "", notes: "",
};

export function Usage() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<(typeof EMPTY_FORM & { id?: number }) | null>(null);
  const [importing, setImporting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [t, r, ins] = await Promise.all([
        api.get<Trend[]>("/usage/trends"),
        api.get<Reading[]>("/usage"),
        api.get<Insight[]>("/usage/insights"),
      ]);
      setTrends(t);
      setReadings(r);
      setInsights(ins);
      setSelected((cur) => cur ?? (t[0]?.utility_type ?? null));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const active = useMemo(
    () => trends.find((t) => t.utility_type === selected) ?? null,
    [trends, selected],
  );

  const shownReadings = useMemo(
    () => (selected ? readings.filter((r) => r.utility_type === selected) : readings),
    [readings, selected],
  );

  const chartData = useMemo(() => {
    if (!active) return [];
    return active.points.map((p) => ({
      label: p.period_end ? fmtDate(p.period_end) : "—",
      usage: p.usage,
      cost: p.cost,
      cpu: p.cost_per_unit,
    }));
  }, [active]);

  async function remove(id: number) {
    if (!confirm("Delete this reading?")) return;
    await api.del(`/usage/${id}`);
    load();
  }

  async function removeAll(t: Trend) {
    if (!confirm(`Delete all ${t.count} ${TYPE_LABEL[t.utility_type] ?? t.utility_type} reading${t.count === 1 ? "" : "s"}? This can't be undone.`)) return;
    await api.del(`/usage?utility_type=${encodeURIComponent(t.utility_type)}`);
    setSelected(null);
    load();
  }

  function startEdit(r: Reading) {
    setEditing({
      id: r.id,
      utility_type: r.utility_type,
      period_start: r.period_start ?? "",
      period_end: r.period_end ?? "",
      usage: r.usage != null ? String(r.usage) : "",
      unit: r.unit ?? "",
      cost: r.cost != null ? String(r.cost) : "",
      notes: r.notes ?? "",
    });
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Usage</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Track what you consume — power, water, gas — so you can see usage trends, not just the bill.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" icon="Upload" onClick={() => setImporting(true)}>Import</Button>
          <Button icon="Plus" onClick={() => setEditing({ ...EMPTY_FORM })}>Add reading</Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : trends.length === 0 ? (
        <Card>
          <EmptyState
            title="No usage logged yet."
            body="Add a reading from a utility statement, or import a CSV, to start trending consumption."
            icon="Gauge"
            action={<Button icon="Plus" onClick={() => setEditing({ ...EMPTY_FORM })}>Add reading</Button>}
          />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Per-utility summary cards — click to focus the chart */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
            {trends.map((t) => {
              const isActive = t.utility_type === selected;
              const delta = t.latest_usage != null && t.avg_usage != null
                ? t.latest_usage - t.avg_usage : null;
              const pct = delta != null && t.avg_usage ? (delta / t.avg_usage) * 100 : null;
              return (
                <Card
                  key={t.utility_type}
                  onClick={() => setSelected(t.utility_type)}
                  style={{
                    cursor: "pointer",
                    borderColor: isActive ? "var(--brand)" : undefined,
                  } as any}
                >
                  <Eyebrow>{TYPE_LABEL[t.utility_type] ?? t.utility_type}</Eyebrow>
                  <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 500, color: "var(--fg-1)" }}>
                      {t.latest_usage != null ? t.latest_usage.toLocaleString() : "—"}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{t.unit || ""}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
                    {pct != null ? (
                      <span style={{ color: pct > 10 ? "var(--warning)" : pct < -10 ? "var(--success)" : "var(--fg-3)" }}>
                        {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs avg
                      </span>
                    ) : (
                      <span>{t.count} reading{t.count === 1 ? "" : "s"}</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Focused trend chart */}
          {active && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Eyebrow>{TYPE_LABEL[active.utility_type] ?? active.utility_type} · usage & cost over time</Eyebrow>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ minWidth: 160 }}>
                    <Select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
                      {trends.map((t) => (
                        <option key={t.utility_type} value={t.utility_type}>
                          {TYPE_LABEL[t.utility_type] ?? t.utility_type}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button variant="ghost" size="sm" icon="Trash2" onClick={() => removeAll(active)}>
                    Delete set
                  </Button>
                </div>
              </div>
              <div style={{ height: 320 }}>
                {chartData.length === 0 ? (
                  <EmptyState title="No points to chart." icon="BarChart3" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="left" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, name: string) =>
                          name === "Cost" ? `$${fmtMoney(Number(v))}` : `${Number(v).toLocaleString()} ${active.unit || ""}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: "var(--fg-2)" }} />
                      <Bar yAxisId="left" dataKey="usage" name={`Usage (${active.unit || "qty"})`} fill="var(--brand)" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="cost" name="Cost" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          )}

          {selected && insights.find((i) => i.utility_type === selected) && (
            <RateInsight ins={insights.find((i) => i.utility_type === selected)!} />
          )}

          {/* All readings */}
          <div>
            <Eyebrow>{selected ? `${TYPE_LABEL[selected] ?? selected} readings` : "All readings"}</Eyebrow>
            <Card padding={0} style={{ marginTop: 12, overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 120px 120px 120px 76px",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: 11, fontWeight: 600, color: "var(--fg-3)",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}
              >
                <span>Type</span>
                <span>Period ending</span>
                <span style={{ textAlign: "right" }}>Usage</span>
                <span style={{ textAlign: "right" }}>Cost</span>
                <span style={{ textAlign: "right" }}>Per unit</span>
                <span></span>
              </div>
              {shownReadings.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr 120px 120px 120px 76px",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border-subtle)",
                    fontSize: 13,
                  }}
                >
                  <span><Badge tone="neutral">{TYPE_LABEL[r.utility_type] ?? r.utility_type}</Badge></span>
                  <span style={{ color: "var(--fg-1)" }}>
                    {fmtDate(r.period_end)}
                    {r.period_start && <span style={{ color: "var(--fg-3)" }}> · from {fmtDate(r.period_start)}</span>}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>
                    {r.usage != null ? `${r.usage.toLocaleString()} ${r.unit || ""}` : "—"}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>
                    ${fmtMoney(r.cost)}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-3)" }}>
                    {r.cost_per_unit != null ? `$${r.cost_per_unit.toFixed(3)}` : "—"}
                  </span>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                    <Button variant="ghost" size="sm" icon="Pencil" onClick={() => startEdit(r)}>{""}</Button>
                    <Button variant="ghost" size="sm" icon="Trash2" onClick={() => remove(r.id)}>{""}</Button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}

      {editing && (
        <ReadingEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {importing && (
        <ImportReadings onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />
      )}
    </>
  );
}

function RateInsight({ ins }: { ins: Insight }) {
  const unit = ins.unit || "unit";
  const line = (d: Decomp, when: string) => {
    const rose = d.cost_change >= 0;
    const usingMore = d.usage_change_pct >= 0;
    const rateUp = d.rate_change_pct >= 0;
    return (
      <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--fg-1)" }}>vs {when}:</strong>{" "}
        usage {d.usage_change_pct >= 0 ? "+" : ""}{d.usage_change_pct}%, rate{" "}
        <span style={{ color: rateUp ? "var(--warning)" : "var(--success)" }}>
          {d.rate_change_pct >= 0 ? "+" : ""}{d.rate_change_pct}%
        </span>. Bill {rose ? "rose" : "fell"} ${fmtMoney(Math.abs(d.cost_change))} —{" "}
        about ${fmtMoney(Math.abs(d.usage_effect))} from {usingMore ? "using more" : "using less"},{" "}
        ${fmtMoney(Math.abs(d.rate_effect))} from {rateUp ? "a higher rate" : "a lower rate"}.
      </div>
    );
  };
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <Eyebrow>What changed</Eyebrow>
        <span style={{ fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>
          ${ins.latest.rate.toFixed(3)}/{unit} latest
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {line(ins.vs_prior, "last reading")}
        {ins.vs_year_ago && line(ins.vs_year_ago, "a year ago")}
      </div>
    </Card>
  );
}

function ReadingEditor({
  initial, onClose, onSaved,
}: { initial: typeof EMPTY_FORM & { id?: number }; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function onTypeChange(type: string) {
    // auto-fill the unit when the user hasn't set one
    const unit = !form.unit || Object.values(DEFAULT_UNIT).includes(form.unit)
      ? (DEFAULT_UNIT[type] ?? "")
      : form.unit;
    set({ utility_type: type, unit });
  }

  async function save() {
    if (!form.period_end) { setError("The statement end date is required."); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        utility_type: form.utility_type,
        period_start: form.period_start || null,
        period_end: form.period_end,
        usage: form.usage === "" ? null : Number(form.usage),
        unit: form.unit || null,
        cost: form.cost === "" ? 0 : Number(form.cost),
        notes: form.notes || null,
      };
      if (form.id) await api.put(`/usage/${form.id}`, payload);
      else await api.post("/usage", payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Could not save.");
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={form.id ? "Edit reading" : "Add a reading"}
      subtitle="From a utility statement: what you used and what it cost."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy}>Save</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Utility">
          <Select value={form.utility_type} onChange={(e) => onTypeChange(e.target.value)}>
            {UTILITY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Period start" hint="optional">
            <Input type="date" value={form.period_start} onChange={(e) => set({ period_start: e.target.value })} />
          </Field>
          <Field label="Period end">
            <Input type="date" value={form.period_end} onChange={(e) => set({ period_end: e.target.value })} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Usage" hint="quantity consumed">
            <Input inputMode="decimal" value={form.usage} onChange={(e) => set({ usage: e.target.value })} placeholder="920" />
          </Field>
          <Field label="Unit">
            <Input value={form.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="kWh" />
          </Field>
        </div>
        <Field label="Cost">
          <Input prefix="$" inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="134.20" />
        </Field>
        <Field label="Notes" hint="optional">
          <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
      </div>
    </Modal>
  );
}

type ParsedReading = {
  utility_type: string | null; period_start: string | null; period_end: string | null;
  usage: number | null; unit: string | null; cost: number;
};
type ParseMeta = {
  format: string; detected_type: string | null; detected_unit: string | null;
  months: number; source_file?: string;
};

const FORMAT_LABEL: Record<string, string> = {
  espi_xml: "Green Button / interval XML", pdf_grid: "Usage-grid PDF", csv: "CSV",
};

function ImportReadings({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ readings: ParsedReading[]; meta: ParseMeta } | null>(null);
  const [overrideType, setOverrideType] = useState("electric");
  const [overrideUnit, setOverrideUnit] = useState("");
  const [multiplier, setMultiplier] = useState("1");
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);

  async function readFile() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await api.upload<{ readings: ParsedReading[]; meta: ParseMeta }>("/usage/parse", file);
      setParsed(r);
      // Don't guess a type when the file doesn't carry one (e.g. a usage PDF) —
      // forcing a choice prevents silently overwriting another utility's months.
      setOverrideType(r.meta.detected_type || r.readings.find((x) => x.utility_type)?.utility_type || "");
      setOverrideUnit(r.meta.detected_unit || r.readings.find((x) => x.unit)?.unit || "");
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't read that file.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!parsed) return;
    setBusy(true); setError(null);
    try {
      // Fill in type/unit where the file didn't carry them (e.g. the PDF grid),
      // and scale usage by the multiplier (e.g. ×100 for "hundreds of gallons").
      const mult = Number(multiplier) || 1;
      const readings = parsed.readings.map((r) => ({
        ...r,
        utility_type: r.utility_type || overrideType,
        unit: r.unit || (overrideUnit || null),
        usage: r.usage != null ? r.usage * mult : null,
      }));
      const r = await api.post<{ created: number; updated: number }>("/usage/bulk", {
        readings, source_file: parsed.meta.source_file,
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't save.");
    } finally { setBusy(false); }
  }

  const preview = parsed?.readings.slice(0, 6) ?? [];
  // If any row lacks a type (PDF) and the user hasn't chosen one, block import so
  // we never default to the wrong utility and overwrite its months.
  const needsType = !!parsed && !overrideType && parsed.readings.some((r) => !r.utility_type);

  return (
    <Modal
      open
      onClose={onClose}
      title="Import usage"
      subtitle="CSV, a Green Button XML export, or a utility usage-report PDF."
      width={560}
      footer={
        result ? (
          <Button variant="primary" onClick={onDone}>Done</Button>
        ) : parsed ? (
          <>
            <Button variant="ghost" onClick={() => { setParsed(null); setFile(null); }}>Back</Button>
            <Button variant="primary" onClick={save} loading={busy} disabled={needsType}>
              Import {parsed.readings.length} month{parsed.readings.length === 1 ? "" : "s"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={readFile} disabled={!file} loading={busy}>Read it</Button>
          </>
        )
      }
    >
      {result ? (
        <div style={{ fontSize: 14, color: "var(--fg-1)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div>Added <strong>{result.created}</strong> new month{result.created === 1 ? "" : "s"}.</div>
          {result.updated > 0 && <div style={{ color: "var(--fg-3)" }}>Updated {result.updated} existing.</div>}
        </div>
      ) : parsed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
            Read <strong>{parsed.readings.length}</strong> month{parsed.readings.length === 1 ? "" : "s"} from a{" "}
            {FORMAT_LABEL[parsed.meta.format] ?? parsed.meta.format}.
            {parsed.meta.detected_type
              ? ` Detected ${parsed.meta.detected_type}${parsed.meta.detected_unit ? ` (${parsed.meta.detected_unit})` : ""}.`
              : " It didn't include a utility type or units — set them below."}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Utility" hint={needsType ? "Pick which utility this file is" : undefined}>
              <Select value={overrideType} onChange={(e) => setOverrideType(e.target.value)}>
                <option value="">Choose a utility…</option>
                {UTILITY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
            </Field>
            <Field label="Unit">
              <Input value={overrideUnit} onChange={(e) => setOverrideUnit(e.target.value)} placeholder="kWh, CCF, gal…" />
            </Field>
            <Field label="Multiply usage by" hint="e.g. 100 if values are in hundreds">
              <Input inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} placeholder="1" />
            </Field>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Preview
            </div>
            {preview.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0",
                                     borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                <span style={{ color: "var(--fg-2)" }}>{fmtDate(r.period_end)}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>
                  {r.usage != null ? (r.usage * (Number(multiplier) || 1)).toLocaleString() : "—"} {r.unit || overrideUnit}
                </span>
              </div>
            ))}
            {parsed.readings.length > preview.length && (
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 6 }}>
                + {parsed.readings.length - preview.length} more…
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
            Re-importing months you already have will update them, not duplicate.
          </div>
          {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="file"
            accept=".csv,.xml,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13, color: "var(--fg-2)" }}
          />
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
            Works with a CSV (<code style={{ fontFamily: "var(--font-mono)" }}>type,period_end,usage,unit,cost</code>),
            a Green Button / ESPI XML export, or a utility "usage report" PDF with a year × month grid.
          </div>
          {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
        </div>
      )}
    </Modal>
  );
}
