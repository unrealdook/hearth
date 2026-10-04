import { useState } from "react";
import { Trash2, Wand2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Modal, Button, Input, Select, Badge, Eyebrow } from "@/components/ui";

export type Category = {
  id: number; name: string; color: string | null; sort_order: number; archived: boolean;
  chart_hidden?: boolean; monthly_budget?: number | null;
};
export type Rule = {
  id: number; keyword: string; category: string;
  min_amount: number | null; max_amount: number | null;
  same_day_keyword: string | null; created_at: string;
};

type BandMode = "any" | "over" | "under";

export function bandLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (min != null) return `over $${min}`;
  if (max != null) return `≤ $${max}`;
  return "any amount";
}

/** Human-readable summary of a rule's conditions (band + same-day). */
export function condText(r: Rule): string {
  const parts: string[] = [];
  const b = bandLabel(r.min_amount, r.max_amount);
  if (b !== "any amount") parts.push(b);
  if (r.same_day_keyword) parts.push(`same-day: ${r.same_day_keyword}`);
  return parts.join(" · ") || "any";
}

/** "Any amount / Over $X / Up to $X" picker shared by the teach + manage forms. */
function AmountBand({ mode, amt, onMode, onAmt }: {
  mode: BandMode; amt: string; onMode: (m: BandMode) => void; onAmt: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div style={{ width: 130 }}>
        <Select value={mode} onChange={(e) => onMode(e.target.value as BandMode)} containerStyle={{ height: 36 }}>
          <option value="any">Any amount</option>
          <option value="over">Over…</option>
          <option value="under">Up to…</option>
        </Select>
      </div>
      {mode !== "any" && (
        <Input type="number" value={amt} onChange={(e) => onAmt(e.target.value)}
          prefix="$" placeholder="20" containerStyle={{ height: 36, width: 110 }} />
      )}
    </div>
  );
}

/** Translate the picker state into the {min_amount, max_amount} the API expects. */
function bandPayload(mode: BandMode, amt: string): { min_amount: number | null; max_amount: number | null } {
  const n = parseFloat(amt);
  if (mode === "over" && !isNaN(n)) return { min_amount: n, max_amount: null };
  if (mode === "under" && !isNaN(n)) return { min_amount: null, max_amount: n };
  return { min_amount: null, max_amount: null };
}

/** A <Select> bound to the spending categories. Keeps the current value visible
 * even if it isn't (yet) one of the managed categories. */
export function CategorySelect({
  value, categories, onChange, height = 32,
}: {
  value: string; categories: Category[]; onChange: (v: string) => void; height?: number;
}) {
  const names = categories.filter((c) => !c.archived).map((c) => c.name);
  const extra = value && !names.includes(value) ? [value] : [];
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)} containerStyle={{ height }}>
      <option value="">Uncategorized</option>
      {[...extra, ...names].map((n) => <option key={n} value={n}>{n}</option>)}
    </Select>
  );
}

/** Teach a rule: "always categorize merchants containing <keyword> as <category>". */
export function TeachRuleModal({
  open, onClose, initialKeyword, initialCategory, categories, onSaved,
}: {
  open: boolean; onClose: () => void; initialKeyword: string; initialCategory: string;
  categories: Category[]; onSaved: (msg: string) => void;
}) {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [category, setCategory] = useState(initialCategory);
  const [mode, setMode] = useState<BandMode>("any");
  const [amt, setAmt] = useState("");
  const [sameDay, setSameDay] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const kw = keyword.trim();
    if (!kw || !category) return;
    setBusy(true);
    try {
      const r = await api.post<{ transactions_updated: number }>(
        "/categories/rules", {
          keyword: kw, category, apply_existing: true, ...bandPayload(mode, amt),
          same_day_keyword: sameDay.trim() || null,
        });
      const band = mode === "any" ? "" : mode === "over" ? ` over $${amt}` : ` up to $${amt}`;
      const sd = sameDay.trim() ? ` (same-day as ${sameDay.trim()})` : "";
      onSaved(`Remembered "${kw}"${band}${sd} → ${category}. Re-labeled ${r.transactions_updated} matching transaction${r.transactions_updated === 1 ? "" : "s"}.`);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Remember this merchant" width={460}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!keyword.trim() || !category}>Save rule</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)" }}>
          Any transaction whose description contains this text will be categorized
          automatically — now and on every future import.
        </p>
        <label style={{ fontSize: 12, color: "var(--fg-3)" }}>
          Description contains
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. corner market" containerStyle={{ marginTop: 4 }} autoFocus />
        </label>
        <label style={{ fontSize: 12, color: "var(--fg-3)" }}>
          Category
          <div style={{ marginTop: 4 }}>
            <CategorySelect value={category} categories={categories} onChange={setCategory} height={40} />
          </div>
        </label>
        <label style={{ fontSize: 12, color: "var(--fg-3)" }}>
          Only when the amount is
          <div style={{ marginTop: 4 }}>
            <AmountBand mode={mode} amt={amt} onMode={setMode} onAmt={setAmt} />
          </div>
        </label>
        <label style={{ fontSize: 12, color: "var(--fg-3)" }}>
          Only on a day you also bought (optional)
          <Input value={sameDay} onChange={(e) => setSameDay(e.target.value)}
            placeholder="e.g. aldi" containerStyle={{ marginTop: 4 }} />
        </label>
        <div style={{ fontSize: 12, color: "var(--fg-4)" }}>
          Tip: keep the keyword short (e.g. <code>soccer</code>) so it matches every variation.
          The amount band splits a merchant by size; the same-day field only counts it when
          another transaction that day matches — e.g. Walmart over $50 on an <em>aldi</em> day → Groceries.
        </div>
      </div>
    </Modal>
  );
}

const SWATCHES = ["#4C8C5A", "#E0A458", "#C45D5D", "#8A6FB0", "#5BA3C4", "#6C8EBF",
  "#B07BAC", "#D98E73", "#6FB0A0", "#E5C45B", "#C97FA0", "#7FA9D9", "#B59B5C", "#9AA0A6"];

/** Full management surface: re-categorize everything, manage learned rules, and
 * manage the category list. */
export function ManageModal({
  open, onClose, categories, rules, onChanged, notify,
}: {
  open: boolean; onClose: () => void; categories: Category[]; rules: Rule[];
  onChanged: () => void; notify: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [newKw, setNewKw] = useState("");
  const [newRuleCat, setNewRuleCat] = useState("");
  const [newMode, setNewMode] = useState<BandMode>("any");
  const [newAmt, setNewAmt] = useState("");
  const [newSameDay, setNewSameDay] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(SWATCHES[0]);

  async function recategorize() {
    if (!confirm("Re-run categorization across every saved transaction? This overwrites existing categories (including any you set by hand).")) return;
    setBusy(true);
    try {
      const r = await api.post<{ updated: number; total: number }>("/categories/recategorize", {});
      notify(`Re-categorized ${r.updated} of ${r.total} transactions.`);
      onChanged();
    } finally { setBusy(false); }
  }

  async function addRule() {
    const kw = newKw.trim();
    if (!kw || !newRuleCat) return;
    const r = await api.post<{ transactions_updated: number }>(
      "/categories/rules", {
        keyword: kw, category: newRuleCat, apply_existing: true,
        ...bandPayload(newMode, newAmt), same_day_keyword: newSameDay.trim() || null,
      });
    setNewKw(""); setNewRuleCat(""); setNewMode("any"); setNewAmt(""); setNewSameDay("");
    notify(`Added rule. Re-labeled ${r.transactions_updated} transaction${r.transactions_updated === 1 ? "" : "s"}.`);
    onChanged();
  }
  async function changeRuleCat(id: number, category: string) {
    await api.put(`/categories/rules/${id}`, { category, apply_existing: true });
    onChanged();
  }
  async function deleteRule(id: number) {
    await api.del(`/categories/rules/${id}`);
    onChanged();
  }
  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return;
    try {
      await api.post("/categories", { name, color: newCatColor });
      setNewCatName("");
      onChanged();
    } catch (e: any) {
      alert(e?.message || "Could not add category.");
    }
  }
  async function deleteCategory(id: number, name: string) {
    if (!confirm(`Delete category "${name}"? Transactions keep the label but it won't be in the picker.`)) return;
    await api.del(`/categories/${id}`);
    onChanged();
  }

  return (
    <Modal open={open} onClose={onClose} title="Categories & rules" width={620}
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {/* Recategorize */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
          padding: 14, border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)", background: "var(--surface-inset)" }}>
          <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
            Re-apply rules to everything you've already imported.
          </div>
          <Button variant="secondary" onClick={recategorize} loading={busy}>
            <Wand2 size={15} strokeWidth={1.75} /> Re-categorize all
          </Button>
        </div>

        {/* Rules */}
        <div>
          <Eyebrow>Learned rules</Eyebrow>
          <div style={{ display: "flex", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
            <Input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="description contains…" containerStyle={{ flex: 1, minWidth: 140 }} />
            <AmountBand mode={newMode} amt={newAmt} onMode={setNewMode} onAmt={setNewAmt} />
            <Input value={newSameDay} onChange={(e) => setNewSameDay(e.target.value)} placeholder="same day as… (optional)" containerStyle={{ width: 170 }} />
            <div style={{ width: 150 }}>
              <CategorySelect value={newRuleCat} categories={categories} onChange={setNewRuleCat} height={36} />
            </div>
            <Button variant="secondary" onClick={addRule} disabled={!newKw.trim() || !newRuleCat}><Plus size={15} /> Add</Button>
          </div>
          {rules.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--fg-4)" }}>No rules yet. Teach one from a transaction, or add above.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {rules.map((r) => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 150px 150px 32px", gap: 8, alignItems: "center" }}>
                  <code style={{ fontSize: 13, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.keyword}</code>
                  <span style={{ fontSize: 12, color: condText(r) !== "any" ? "var(--fg-2)" : "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {condText(r)}
                  </span>
                  <CategorySelect value={r.category} categories={categories} onChange={(v) => changeRuleCat(r.id, v)} height={32} />
                  <Button variant="ghost" onClick={() => deleteRule(r.id)} title="Delete rule"><Trash2 size={14} /></Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categories */}
        <div>
          <Eyebrow>Categories</Eyebrow>
          <div style={{ display: "flex", gap: 8, margin: "10px 0", alignItems: "center" }}>
            <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="new category name" containerStyle={{ flex: 1 }} />
            <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)}
              style={{ width: 36, height: 36, border: "1px solid var(--border-default)", borderRadius: 8, background: "none", cursor: "pointer" }} />
            <Button variant="secondary" onClick={addCategory} disabled={!newCatName.trim()}><Plus size={15} /> Add</Button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {categories.filter((c) => !c.archived).map((c) => (
              <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 8px 4px 6px", border: "1px solid var(--border-subtle)", borderRadius: 999, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color || "var(--fg-4)" }} />
                {c.name}
                <button onClick={() => deleteCategory(c.id, c.name)} title="Delete"
                  style={{ border: "none", background: "none", color: "var(--fg-4)", cursor: "pointer", display: "flex", padding: 0 }}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
