import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { Card, Button, Eyebrow, Amount, Spinner, EmptyState, Field, Input } from "@/components/ui";

type Entry = {
  id: number; year: number;
  gross_amount: number;             // the account owner
  partner_amount: number | null;    // second earner (null = not tracked that year)
  combined_amount: number;
  notes: string | null;
};

/** Who the two income columns belong to. Named in settings, not in the schema,
 *  so the app isn't tied to one household. */
type Labels = { self_label: string; partner_label: string };

type SeriesKey = "me" | "partner" | "combined";

export function IncomeTrend() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState("");
  const [gross, setGross] = useState("");
  const [partner, setPartner] = useState("");
  const [labels, setLabels] = useState<Labels>({ self_label: "Me", partner_label: "Partner" });
  const [editingLabels, setEditingLabels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ me: true, partner: true, combined: true });

  const SERIES: { key: SeriesKey; label: string; color: string }[] = [
    { key: "me", label: labels.self_label, color: "var(--brand)" },
    { key: "partner", label: labels.partner_label, color: "var(--warning)" },
    { key: "combined", label: "Combined", color: "var(--success)" },
  ];

  async function load() {
    setLoading(true);
    try {
      const [rows, lbl] = await Promise.all([
        api.get<Entry[]>("/annual-income"),
        api.get<Labels>("/annual-income/labels"),
      ]);
      setEntries(rows);
      setLabels(lbl);
      // default the year field to the next untracked year
      if (!year) {
        const latest = rows.length ? Math.max(...rows.map((r) => r.year)) : new Date().getFullYear() - 1;
        setYear(String(latest + 1));
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => a.year - b.year);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const pct = first.combined_amount > 0
      ? ((last.combined_amount - first.combined_amount) / first.combined_amount) * 100
      : null;
    return { first, last, pct, count: sorted.length };
  }, [entries]);

  function parseAmount(s: string): number | null {
    if (!s.trim()) return null;
    const n = Number(s.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  async function add() {
    const y = parseInt(year, 10);
    const g = parseAmount(gross);
    const j = parseAmount(partner);
    if (!y || (g === null && j === null)) { setError("Enter a valid year and at least one amount."); return; }
    setBusy(true); setError(null);
    try {
      // partner_amount is always sent so an emptied field clears it on edit
      const body: Record<string, unknown> = { year: y, partner_amount: j };
      if (g !== null) body.gross_amount = g;
      await api.post("/annual-income", body);
      setGross(""); setPartner("");
      setYear(String(y + 1));
      await load();
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Couldn't save.");
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!confirm("Remove this year?")) return;
    await api.del(`/annual-income/${id}`);
    load();
  }

  function editRow(e: Entry) {
    setYear(String(e.year));
    setGross(String(e.gross_amount));
    setPartner(e.partner_amount == null ? "" : String(e.partner_amount));
  }

  const chartData = useMemo(
    () => [...entries].sort((a, b) => a.year - b.year).map((e) => ({
      year: e.year,
      me: e.gross_amount,
      partner: e.partner_amount, // null years leave a gap in that line
      combined: e.combined_amount,
    })),
    [entries],
  );
  async function saveLabels() {
    setBusy(true);
    try {
      setLabels(await api.put<Labels>("/annual-income/labels", {
        self_label: labels.self_label,
        partner_label: labels.partner_label,
      }));
      setEditingLabels(false);
    } finally { setBusy(false); }
  }

  const tableRows = useMemo(() => [...entries].sort((a, b) => b.year - a.year), [entries]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Income trend</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Gross income by year — {labels.self_label}, {labels.partner_label}, and combined. The long view.
          </p>
        </div>
        <Button variant="ghost" size="sm" icon="Users" onClick={() => setEditingLabels((v) => !v)}>
          {editingLabels ? "Done" : "Rename earners"}
        </Button>
      </div>

      {editingLabels && (
        <Card style={{ marginBottom: 20 }}>
          <Eyebrow>Who these columns belong to</Eyebrow>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            Labels only — your figures aren't touched. Leave blank to fall back to
            "Me" and "Partner".
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="You" style={{ width: 190 }}>
              <Input value={labels.self_label}
                     onChange={(e) => setLabels({ ...labels, self_label: e.target.value })}
                     placeholder="Me" />
            </Field>
            <Field label="Second earner" style={{ width: 190 }}>
              <Input value={labels.partner_label}
                     onChange={(e) => setLabels({ ...labels, partner_label: e.target.value })}
                     placeholder="Partner" />
            </Field>
            <Button variant="primary" loading={busy} onClick={saveLabels}>Save names</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
              <Card>
                <Eyebrow>Latest combined ({stats.last.year})</Eyebrow>
                <div style={{ marginTop: 10 }}><Amount value={stats.last.combined_amount} size="lg" /></div>
                {stats.last.partner_amount != null && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
                    {labels.self_label} ${fmtMoney(stats.last.gross_amount)} · {labels.partner_label} ${fmtMoney(stats.last.partner_amount)}
                  </div>
                )}
              </Card>
              <Card>
                <Eyebrow>Since {stats.first.year}</Eyebrow>
                <div style={{ marginTop: 10, fontSize: 26, fontWeight: 500, fontFamily: "var(--font-mono)",
                              color: stats.pct == null ? "var(--fg-1)" : stats.pct >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {stats.pct == null ? "—" : `${stats.pct >= 0 ? "+" : ""}${stats.pct.toFixed(0)}%`}
                </div>
              </Card>
              <Card>
                <Eyebrow>Years tracked</Eyebrow>
                <div style={{ marginTop: 10, fontSize: 26, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>
                  {stats.count}
                </div>
              </Card>
            </div>
          )}

          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <Eyebrow>Gross income by year</Eyebrow>
              <div style={{ display: "flex", gap: 8 }}>
                {SERIES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
                      borderRadius: 999, border: "1px solid var(--border-default)", cursor: "pointer",
                      background: visible[s.key] ? "var(--surface-2)" : "transparent",
                      color: visible[s.key] ? "var(--fg-1)" : "var(--fg-3)", fontSize: 12,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999,
                                   background: s.color, opacity: visible[s.key] ? 1 : 0.3 }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 12, height: 320 }}>
              {chartData.length === 0 ? (
                <EmptyState title="No years logged yet." body="Add a year and gross amount below to start the trend." icon="TrendingUp" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false}
                           type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} />
                    <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false}
                           tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, name: string) => [`$${fmtMoney(v)}`, name]}
                      labelFormatter={(l) => `Year ${l}`}
                    />
                    {SERIES.filter((s) => visible[s.key]).map((s) => (
                      <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                            stroke={s.color} strokeWidth={2} dot={{ r: 3, fill: s.color }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card>
            <Eyebrow>Add or update a year</Eyebrow>
            <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Year" style={{ width: 140 }}>
                <Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2024" />
              </Field>
              <Field label="My gross" style={{ width: 190 }}>
                <Input prefix="$" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="115,000" />
              </Field>
              <Field label={`${labels.partner_label} gross`} style={{ width: 190 }}>
                <Input prefix="$" inputMode="decimal" value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="70,000" />
              </Field>
              <Button variant="primary" size="md" icon="Plus" onClick={add} loading={busy}>Save year</Button>
              {error && <span style={{ fontSize: 13, color: "var(--danger)" }}>{error}</span>}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
              Re-saving a year overwrites it. Click a row below to edit it. Leave {labels.partner_label} blank for an untracked year.
            </div>

            {tableRows.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 1fr 44px", gap: 12,
                              padding: "0 4px 8px", fontSize: 11, textTransform: "uppercase",
                              letterSpacing: "0.06em", color: "var(--fg-3)" }}>
                  <span>Year</span><span>{labels.self_label}</span><span>{labels.partner_label}</span><span>Combined</span><span />
                </div>
                {tableRows.map((e) => (
                  <div
                    key={e.id}
                    onClick={() => editRow(e)}
                    style={{
                      display: "grid", gridTemplateColumns: "100px 1fr 1fr 1fr 44px", gap: 12, alignItems: "center",
                      padding: "10px 4px", borderTop: "1px solid var(--border-subtle)", cursor: "pointer", fontSize: 14,
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>{e.year}</span>
                    <Amount value={e.gross_amount} size="sm" />
                    {e.partner_amount == null
                      ? <span style={{ color: "var(--fg-3)" }}>—</span>
                      : <Amount value={e.partner_amount} size="sm" />}
                    <Amount value={e.combined_amount} size="sm" />
                    <Button variant="ghost" size="sm" icon="Trash2"
                            onClick={(ev) => { ev.stopPropagation(); remove(e.id); }}>{""}</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
