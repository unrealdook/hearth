import { useEffect, useMemo, useRef, useState } from "react";
import { api, uploadFile, photoUrl } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import {
  Card, Button, Eyebrow, Amount, Spinner, EmptyState, Modal, Field, Input,
  Textarea, Select, Badge,
} from "@/components/ui";
import { Private } from "@/hooks/usePrivacy";

type GiveEvent = {
  id: number; occurred_on: string; amount: number; recipient: string;
  category: string; note: string | null; has_photo: boolean;
};

type Income = {
  id: number; amount: number; frequency: string; type: string;
};

type Budget = {
  id: number; source: string;
  live_pct: number; invest_pct: number; save_pct: number; debt_pct: number; give_pct: number;
};

const FREQ_PER_YEAR: Record<string, number> = {
  monthly: 12, biweekly: 26, per_check: 26, semimonthly: 24, weekly: 52, annual: 1,
};

const CATEGORIES: { value: string; label: string; tone: "info" | "success" | "warning" | "neutral" }[] = [
  { value: "church",   label: "Church",   tone: "info" },
  { value: "charity",  label: "Charity",  tone: "success" },
  { value: "missions", label: "Missions", tone: "warning" },
  { value: "person",   label: "Person",   tone: "neutral" },
  { value: "other",    label: "Other",    tone: "neutral" },
];

function categoryMeta(v: string) {
  return CATEGORIES.find((c) => c.value === v) ?? CATEGORIES[CATEGORIES.length - 1];
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

export function Give() {
  const [items, setItems] = useState<GiveEvent[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [editing, setEditing] = useState<Partial<GiveEvent> | null>(null);
  const [viewingPhotoFor, setViewingPhotoFor] = useState<GiveEvent | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [g, i, b] = await Promise.all([
        api.get<GiveEvent[]>(`/give?year=${year}`),
        api.get<Income[]>("/income"),
        api.get<Budget[]>("/budget"),
      ]);
      setItems(g);
      setIncomes(i);
      setBudgets(b);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [year]);

  // Annual take-home: sum of (per_check × per_year) across all income sources.
  // `amount` field is net per check, so this is take-home / net.
  const annualTakeHome = useMemo(() => {
    return incomes.reduce((s, i) => {
      const perYear = FREQ_PER_YEAR[i.frequency] ?? 12;
      return s + (i.amount || 0) * perYear;
    }, 0);
  }, [incomes]);

  // Use the highest give_pct across budgets (typically there's just "default")
  const givePct = useMemo(() => {
    return budgets.reduce((m, b) => Math.max(m, b.give_pct || 0), 0);
  }, [budgets]);

  const annualGoal = useMemo(() => (givePct / 100) * annualTakeHome, [givePct, annualTakeHome]);

  const totals = useMemo(() => {
    const total = items.reduce((s, i) => s + (i.amount || 0), 0);
    const byCat = new Map<string, number>();
    for (const i of items) {
      byCat.set(i.category, (byCat.get(i.category) ?? 0) + (i.amount || 0));
    }
    return { total, byCat };
  }, [items]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2, now - 3];
  }, []);

  async function save(form: Partial<GiveEvent>, photo: File | null) {
    let saved: GiveEvent;
    if (form.id) {
      saved = await api.put<GiveEvent>(`/give/${form.id}`, form);
    } else {
      saved = await api.post<GiveEvent>("/give", form);
    }
    if (photo) {
      await uploadFile<GiveEvent>(`/give/${saved.id}/photo`, photo, "photo");
    }
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this gift? Photo will also be deleted.")) return;
    await api.del(`/give/${id}`);
    load();
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Give</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Where the family gave this year. Attach a photo to remember the moment.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} containerStyle={{ width: 120 }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Button icon="Plus" onClick={() => setEditing({ category: "church", occurred_on: todayISO() })}>Add gift</Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 16, marginBottom: 24 }}>
        <Card>
          <Eyebrow>Given ({year})</Eyebrow>
          <div style={{ marginTop: 12 }}><Amount value={totals.total} size="xl" /></div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)" }}>
            {items.length} {items.length === 1 ? "gift" : "gifts"}
          </div>
          {annualGoal > 0 && (() => {
            const pct = annualGoal > 0 ? Math.min(100, (totals.total / annualGoal) * 100) : 0;
            const remaining = Math.max(0, annualGoal - totals.total);
            const over = totals.total > annualGoal;
            return (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-3)", marginBottom: 6 }}>
                  <span>Goal · {givePct}% of take-home</span>
                  <span><Private strength={6}>${fmtMoney(annualGoal)}</Private></span>
                </div>
                <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    width: `${pct}%`, height: "100%",
                    background: over ? "var(--success)" : "var(--brand)",
                    transition: "width var(--dur-state) var(--ease)",
                  }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--fg-3)", display: "flex", justifyContent: "space-between" }}>
                  <span>{pct.toFixed(0)}% of goal</span>
                  <span>
                    {over
                      ? <span style={{ color: "var(--success)" }}>+${fmtMoney(totals.total - annualGoal)} over</span>
                      : <>${fmtMoney(remaining)} to go</>}
                  </span>
                </div>
              </div>
            );
          })()}
          {annualGoal === 0 && annualTakeHome > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)",
                          fontSize: 11, color: "var(--fg-3)" }}>
              Set a "Give %" in your budget allocation (Income page) to track against a goal.
            </div>
          )}
        </Card>
        <Card>
          <Eyebrow>By category</Eyebrow>
          {totals.byCat.size === 0 ? (
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--fg-3)" }}>
              Nothing logged yet for {year}.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {[...totals.byCat.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amt]) => {
                  const meta = categoryMeta(cat);
                  const pct = totals.total > 0 ? (amt / totals.total) * 100 : 0;
                  return (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 90 }}><Badge tone={meta.tone}>{meta.label}</Badge></div>
                      <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand)" }} />
                      </div>
                      <div style={{ width: 100, textAlign: "right" }}><Amount value={amt} size="sm" /></div>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner /></div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={`Nothing recorded for ${year}.`}
            body="Log a gift so it shows up here and in the family report."
            icon="Heart"
            action={<Button icon="Plus" onClick={() => setEditing({ category: "church", occurred_on: todayISO() })}>Add gift</Button>}
          />
        </Card>
      ) : (
        <Card padding={0}>
          {items.map((it, idx) => {
            const meta = categoryMeta(it.category);
            return (
              <div
                key={it.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px 1fr 110px 130px 80px",
                  gap: 16,
                  alignItems: "center",
                  padding: "14px 20px",
                  borderBottom: idx === items.length - 1 ? "none" : "1px solid var(--border-subtle)",
                }}
              >
                <div>
                  {it.has_photo ? (
                    <button
                      onClick={() => setViewingPhotoFor(it)}
                      style={{
                        width: 48, height: 48, borderRadius: 8, padding: 0, overflow: "hidden",
                        border: "1px solid var(--border-subtle)", background: "var(--surface-inset)",
                        cursor: "pointer",
                      }}
                      title="View photo"
                    >
                      <img
                        src={photoUrl(`/give/${it.id}/photo`)}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </button>
                  ) : (
                    <div style={{
                      width: 48, height: 48, borderRadius: 8,
                      border: "1px dashed var(--border-subtle)", background: "var(--surface-inset)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: "var(--fg-4)",
                    }}>—</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    <Private strength={9}>{it.recipient}</Private>
                  </div>
                  <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {it.note && (
                      <div style={{
                        fontSize: 12, color: "var(--fg-3)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        maxWidth: 360,
                      }}>{it.note}</div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--fg-2)" }}>{fmtDate(it.occurred_on)}</div>
                <div style={{ textAlign: "right" }}><Amount value={it.amount} size="md" /></div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                  <Button variant="ghost" size="sm" icon="Pencil" onClick={() => setEditing(it)}>{""}</Button>
                  <Button variant="ghost" size="sm" icon="Trash2" onClick={() => remove(it.id)}>{""}</Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {editing && (
        <GiveEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      {viewingPhotoFor && (
        <PhotoViewer event={viewingPhotoFor} onClose={() => setViewingPhotoFor(null)} onDeleted={() => { setViewingPhotoFor(null); load(); }} />
      )}
    </>
  );
}

function GiveEditor({
  initial, onClose, onSave,
}: { initial: Partial<GiveEvent>; onClose: () => void; onSave: (g: Partial<GiveEvent>, photo: File | null) => Promise<void> }) {
  const [form, setForm] = useState<any>({
    occurred_on: initial.occurred_on ?? todayISO(),
    amount: initial.amount ?? "",
    recipient: initial.recipient ?? "",
    category: initial.category ?? "church",
    note: initial.note ?? "",
    id: initial.id,
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickPhoto(f: File | null) {
    setPhoto(f);
    if (!f) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(f);
    setPhotoPreview(url);
  }

  const canSave = !!form.recipient && Number(form.amount) > 0 && !!form.occurred_on;

  async function submit() {
    setSaving(true);
    try {
      await onSave({ ...form, amount: Number(form.amount) || 0 }, photo);
    } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose}
      title={initial.id ? "Edit gift" : "Add gift"}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!canSave || saving} onClick={submit}>Save</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Recipient">
          <Input value={form.recipient}
            onChange={(e) => setForm({ ...form, recipient: e.target.value })}
            placeholder="Church name, charity, person's name…" />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Category" style={{ flex: 1 }}>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Date" style={{ flex: 1 }}>
            <Input type="date" value={form.occurred_on}
              onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
          </Field>
          <Field label="Amount" style={{ flex: 1 }}>
            <Input prefix="$" value={form.amount} inputMode="decimal"
              onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="e.g. weekly tithe, hurricane relief, niece's birthday" rows={2} />
        </Field>
        <Field label="Photo (optional)">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
            {photoPreview ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src={photoPreview} alt=""
                  style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover",
                           border: "1px solid var(--border-subtle)" }} />
                <Button variant="ghost" size="sm" icon="X" onClick={() => pickPhoto(null)}>Remove</Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" icon="Image" onClick={() => fileRef.current?.click()}>Choose photo</Button>
            )}
            {initial.id && initial.has_photo && !photo && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-3)" }}>
                Existing photo on file. Choosing a new one will replace it.
              </div>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function PhotoViewer({
  event, onClose, onDeleted,
}: { event: GiveEvent; onClose: () => void; onDeleted: () => void }) {
  async function removePhoto() {
    if (!confirm("Remove this photo? The gift entry will stay.")) return;
    await api.del(`/give/${event.id}/photo`);
    onDeleted();
  }
  return (
    <Modal open onClose={onClose}
      title={event.recipient}
      footer={<>
        <Button variant="danger" icon="Trash2" onClick={removePhoto}>Remove photo</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <img
          src={photoUrl(`/give/${event.id}/photo`)}
          alt={event.recipient}
          style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }}
        />
      </div>
    </Modal>
  );
}
