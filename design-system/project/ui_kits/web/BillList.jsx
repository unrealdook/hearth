// Bill row + bill list components

function BillRow({ bill, onClick, onPay }) {
  const [hover, setHover] = React.useState(false);
  const statusBadge = {
    paid: <Badge tone="paid">Paid</Badge>,
    due: <Badge tone="due">Due in {bill.daysUntilDue} days</Badge>,
    overdue: <Badge tone="overdue">Overdue</Badge>,
    sched: <Badge tone="sched">Scheduled</Badge>,
  }[bill.status];
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid', gridTemplateColumns: '44px 1fr auto auto auto',
        alignItems: 'center', gap: 16,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: hover ? 'var(--surface-2)' : 'transparent',
        cursor: 'pointer',
        transition: 'background var(--dur-micro) var(--ease)',
      }}
    >
      <VendorIcon kind={bill.kind} size={36} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-1)' }}>{bill.name}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {bill.category}{bill.autoPay ? ' · Auto-pay' : ''}
        </div>
      </div>
      <div style={{ minWidth: 140, display: 'flex', justifyContent: 'flex-start' }}>{statusBadge}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', minWidth: 60, textAlign: 'right' }}>
        {bill.dueDate}
      </div>
      <div style={{ minWidth: 100, textAlign: 'right' }}>
        <Amount value={bill.amount} size="md" />
      </div>
    </div>
  );
}

function BillList({ bills, onSelect }) {
  return (
    <Card padding={0} style={{ overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '44px 1fr auto auto auto',
        alignItems: 'center', gap: 16,
        padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)',
        fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        <span></span>
        <span>Bill</span>
        <span style={{ minWidth: 140 }}>Status</span>
        <span style={{ minWidth: 60, textAlign: 'right' }}>Due</span>
        <span style={{ minWidth: 100, textAlign: 'right' }}>Amount</span>
      </div>
      {bills.map(b => <BillRow key={b.id} bill={b} onClick={() => onSelect && onSelect(b)} />)}
    </Card>
  );
}

Object.assign(window, { BillRow, BillList });
