import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import {
  Card, Button, Eyebrow, Spinner, EmptyState, Modal, Field, Input, Badge,
} from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";

type Entry = { id: number; score: number; model_name: string; recorded_on: string; notes: string | null };

export function Fico() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);

  async function load() {
    setLoading(true);
    try { setEntries(await api.get<Entry[]>("/fico")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const sorted = useMemo(() => entries.slice().sort((a, b) => a.recorded_on.localeCompare(b.recorded_on)), [entries]);
  const latest = sorted[sorted.length - 1];

  async function save(form: Partial<Entry>) {
    await api.post("/fico", { ...form, score: Number(form.score) });
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this score?")) return;
    await api.del(`/fico/${id}`);
    load();
  }

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>FICO history</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>Log scores manually as you check.</p>
        </div>
        <Button icon="Plus" onClick={() => setEditing({ recorded_on: new Date().toISOString().slice(0, 10), model_name: "FICO Score 8" })}>
          Add score
        </Button>
      </div>

      {entries.length === 0 ? (
        <Card>
          <EmptyState title="No scores yet." body="Add your first FICO reading to start the trend." icon="Gauge"
            action={<Button icon="Plus" onClick={() => setEditing({ recorded_on: new Date().toISOString().slice(0, 10), model_name: "FICO Score 8" })}>Add score</Button>} />
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 16, marginBottom: 24 }}>
            <Card>
              <Eyebrow>Latest</Eyebrow>
              <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 56, fontWeight: 500, letterSpacing: "-0.03em", color: tier(latest.score).color }}>
                <Private>{latest.score}</Private>
              </div>
              <div style={{ marginTop: 8 }}>
                <Badge tone={tier(latest.score).tone}>{tier(latest.score).label}</Badge>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-3)" }}>
                {latest.model_name} · {fmtDate(latest.recorded_on)}
              </div>
            </Card>

            <Card>
              <Eyebrow>Trend</Eyebrow>
              <div style={{ marginTop: 12, height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sorted} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="recorded_on" tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
                    <YAxis domain={[300, 850]} tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="score" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3, fill: "var(--brand)" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card padding={0}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "120px 80px 1fr 1fr 60px",
                gap: 16,
                padding: "12px 20px",
                borderBottom: "1px solid var(--border-subtle)",
                fontSize: 11, fontWeight: 600, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em",
              }}
            >
              <span>Date</span>
              <span>Score</span>
              <span>Model</span>
              <span>Notes</span>
              <span></span>
            </div>
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 80px 1fr 1fr 60px",
                  gap: 16,
                  alignItems: "center",
                  padding: "12px 20px",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--fg-2)" }}>{fmtDate(e.recorded_on)}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: tier(e.score).color }}><Private strength={9}>{e.score}</Private></span>
                <span style={{ color: "var(--fg-2)" }}>{e.model_name}</span>
                <span style={{ color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.notes || "—"}</span>
                <Button variant="ghost" size="sm" onClick={() => remove(e.id)} icon="Trash2">{""}</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Add FICO score"
          footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={() => save(editing)}>Save</Button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Score"><Input value={editing.score ?? ""} onChange={(e) => setEditing({ ...editing, score: Number(e.target.value) })} /></Field>
            <Field label="Date"><Input type="date" value={editing.recorded_on ?? ""} onChange={(e) => setEditing({ ...editing, recorded_on: e.target.value })} /></Field>
            <Field label="Model"><Input value={editing.model_name ?? ""} onChange={(e) => setEditing({ ...editing, model_name: e.target.value })} placeholder="FICO Score 8" /></Field>
            <Field label="Notes"><Input value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function tier(score: number): { label: string; color: string; tone: "success" | "info" | "warning" | "danger" } {
  if (score >= 800) return { label: "Exceptional", color: "var(--success)", tone: "success" };
  if (score >= 740) return { label: "Very good",   color: "var(--info)",    tone: "info"    };
  if (score >= 670) return { label: "Good",        color: "var(--info)",    tone: "info"    };
  if (score >= 580) return { label: "Fair",        color: "var(--warning)", tone: "warning" };
  return { label: "Poor", color: "var(--danger)", tone: "danger" };
}
