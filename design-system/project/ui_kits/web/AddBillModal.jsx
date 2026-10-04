// Add Bill modal

function AddBillModal({ open, onClose, onSave }) {
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [auto, setAuto] = React.useState(true);
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      animation: 'fadeIn 240ms var(--ease)',
    }}>
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } } @keyframes popIn { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: none } }`}</style>
      <div style={{
        background: 'var(--surface-3)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-xl)', padding: 28, width: 480,
        boxShadow: 'var(--shadow-modal)',
        animation: 'popIn 320ms var(--ease)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.01em' }}>Add a bill</div>
            <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 4 }}>We'll keep an eye on it for you.</div>
          </div>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} />
        </div>

        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Bill name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pacific Power" />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Amount" style={{ flex: 1 }}>
              <Input prefix="$" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Due date" style={{ flex: 1 }}>
              <Input icon="calendar" value="May 14, 2026" onChange={() => {}} />
            </Field>
          </div>
          <Field label="Category">
            <Input icon="tag" value="Utilities" onChange={() => {}} />
          </Field>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', borderRadius: 'var(--r-md)',
            background: 'var(--surface-inset)', border: '1px solid var(--border-subtle)',
          }}>
            <Switch on={auto} onChange={setAuto} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-1)' }}>Auto-pay</div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>Pay 2 days before it's due, from Chase ··· 4421</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => { onSave && onSave({ name, amount, auto }); onClose(); }}>Add bill</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

Object.assign(window, { AddBillModal });
