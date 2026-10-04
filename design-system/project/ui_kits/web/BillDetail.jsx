// Bill detail panel — slides in over content from the right

function BillDetail({ bill, onClose, onPay }) {
  if (!bill) return null;
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 420,
      background: 'var(--surface-1)', borderLeft: '1px solid var(--border-default)',
      padding: 28, overflowY: 'auto',
      animation: 'slideIn 240ms var(--ease)',
    }}>
      <style>{`@keyframes slideIn { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <VendorIcon kind={bill.kind} size={48} />
        <Button variant="ghost" size="sm" icon="x" onClick={onClose} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.01em' }}>{bill.name}</div>
      <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>{bill.category}</div>

      <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
        <Eyebrow>Amount due</Eyebrow>
        <div style={{ marginTop: 8 }}><Amount value={bill.amount} size="xl" /></div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--fg-2)' }}>
          {bill.status === 'due' ? `Due in ${bill.daysUntilDue} days · ${bill.dueDate}`
            : bill.status === 'paid' ? `Paid ${bill.paidDate}`
            : `Scheduled for ${bill.dueDate}`}
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        {bill.status !== 'paid' && <Button variant="primary" size="md" onClick={() => onPay && onPay(bill)}>Pay $ {bill.amount.toFixed(2)}</Button>}
        <Button variant="secondary" size="md" icon="bell">Remind me</Button>
      </div>

      <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
        <Eyebrow>Details</Eyebrow>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <DetailRow label="Account" value="••• 4421 · Chase" />
          <DetailRow label="Frequency" value="Monthly" />
          <DetailRow label="Auto-pay" value={bill.autoPay ? 'On · 2 days before due' : 'Off'} />
          <DetailRow label="Reminder" value="3 days before" />
        </div>
      </div>

      <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
        <Eyebrow>Recent payments</Eyebrow>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
          {[
            { d: 'Apr 14, 2026', a: 138.10 },
            { d: 'Mar 14, 2026', a: 144.92 },
            { d: 'Feb 14, 2026', a: 156.30 },
          ].map((p, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: i < 2 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{p.d}</span>
              <Amount value={p.a} size="sm" muted />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--fg-3)' }}>{label}</span>
      <span style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

Object.assign(window, { BillDetail });
