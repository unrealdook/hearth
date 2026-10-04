import { useState } from "react";
import { api } from "@/lib/api";
import {
  Button, Modal, Input, Field, Select, Switch, Textarea,
} from "@/components/ui";
import { BILL_CATEGORIES, VENDOR_KINDS } from "@/lib/bills";

type Props = {
  initial: any;
  onClose: () => void;
  onSaved: () => void;
};

export function BillEditor({ initial, onClose, onSaved }: Props) {
  const isNew = !initial.id;
  const [form, setForm] = useState({ ...initial, username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends string>(key: K, value: any) {
    setForm((f: any) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    try {
      const payload: any = {
        category: form.category,
        name: form.name,
        amount: Number(form.amount) || 0,
        credit_limit: form.credit_limit === "" || form.credit_limit == null ? null : Number(form.credit_limit),
        balance_remaining: form.balance_remaining === "" || form.balance_remaining == null ? null : Number(form.balance_remaining),
        due_day: form.due_day === "" || form.due_day == null ? null : Number(form.due_day),
        term_months: form.term_months === "" || form.term_months == null ? null : Number(form.term_months),
        notes: form.notes || null,
        payment_url: form.payment_url || null,
        is_autopay: !!form.is_autopay,
        is_active: form.is_active === undefined ? true : !!form.is_active,
        kind: form.kind || "other",
        usage_unit: form.usage_unit ? String(form.usage_unit).trim() : null,
      };
      if (form.username) payload.username = form.username;
      if (form.password) payload.password = form.password;
      if (isNew) await api.post("/bills", payload);
      else await api.put(`/bills/${initial.id}`, payload);
      onSaved();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!initial.id) return;
    if (!confirm(`Delete "${initial.name}"? This will also remove its payment history.`)) return;
    setBusy(true);
    try {
      await api.del(`/bills/${initial.id}`);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add a bill" : "Edit bill"}
      subtitle={isNew ? "We'll keep an eye on it for you." : initial.name}
      width={560}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" size="md" onClick={remove} disabled={busy}>Delete</Button>
          )}
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={save} loading={busy}>
            {isNew ? "Add bill" : "Save"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Bill name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Duke Energy" />
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Category" style={{ flex: 1 }}>
            <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {BILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Type" style={{ flex: 1 }}>
            <Select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              {VENDOR_KINDS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </Select>
          </Field>
        </div>

        <Field
          label="Usage unit (optional)"
          hint="Set this for metered bills (e.g. kWh, gal, therm) to log usage when you mark it paid — feeds the Usage trend."
        >
          <Input value={form.usage_unit ?? ""} onChange={(e) => set("usage_unit", e.target.value)} placeholder="kWh, gal, therm…" />
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Amount" style={{ flex: 1 }}>
            <Input prefix="$" value={form.amount ?? ""} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Due day" style={{ flex: 1 }} hint="day of month, 1–31">
            <Input value={form.due_day ?? ""} onChange={(e) => set("due_day", e.target.value)} placeholder="15" />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Credit limit (optional)" style={{ flex: 1 }}>
            <Input prefix="$" value={form.credit_limit ?? ""} onChange={(e) => set("credit_limit", e.target.value)} placeholder="" />
          </Field>
          <Field label="Term (months, optional)" style={{ flex: 1 }}>
            <Input value={form.term_months ?? ""} onChange={(e) => set("term_months", e.target.value)} placeholder="" />
          </Field>
        </div>

        <Field
          label="Amount left (optional)"
          hint="Remaining balance owed — for loans, mortgages, or any bill where it's useful to track payoff."
        >
          <Input
            prefix="$"
            value={form.balance_remaining ?? ""}
            onChange={(e) => set("balance_remaining", e.target.value)}
            placeholder=""
          />
        </Field>

        <Field label="Payment URL (optional)">
          <Input icon="Link" value={form.payment_url ?? ""} onChange={(e) => set("payment_url", e.target.value)} placeholder="https://..." />
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label={isNew ? "Username (encrypted)" : "Username (leave blank to keep)"} style={{ flex: 1 }}>
            <Input value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} placeholder="" />
          </Field>
          <Field label={isNew ? "Password (encrypted)" : "Password (leave blank to keep)"} style={{ flex: 1 }}>
            <Input
              type={showPassword ? "text" : "password"}
              value={form.password ?? ""}
              onChange={(e) => set("password", e.target.value)}
              placeholder=""
            />
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Switch on={showPassword} onChange={setShowPassword} />
          <span style={{ fontSize: 12, color: "var(--fg-2)" }}>
            {showPassword ? "Showing password while you type" : "Hide password while you type"}
          </span>
        </div>

        <Field label="Notes (optional)">
          <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="account number, reminders…" />
        </Field>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            borderRadius: "var(--r-md)",
            background: "var(--surface-inset)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Switch on={!!form.is_autopay} onChange={(v) => set("is_autopay", v)} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>Auto-pay</div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
              {form.is_autopay
                ? "We'll assume this one settles itself — marking it paid records the month without moving your balance."
                : "You'll see this in the upcoming list each month, and marking it paid deducts from your balance."}
            </div>
          </div>
        </div>

        {!isNew && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px",
              borderRadius: "var(--r-md)",
              background: "var(--surface-inset)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Switch on={!!form.is_active} onChange={(v) => set("is_active", v)} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-1)" }}>Active</div>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>
                Paused bills are hidden from the dashboard.
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
