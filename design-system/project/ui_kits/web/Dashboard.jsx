// Dashboard view: hero summary + upcoming + recently paid

function HeroSummary({ total, dueCount, paidThisMonth }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16,
    }}>
      <Card style={{ position: 'relative', overflow: 'hidden' }}>
        {/* very subtle radial highlight, the only "texture" allowed */}
        <div style={{
          position: 'absolute', top: -80, right: -80, width: 320, height: 320,
          background: 'radial-gradient(circle, rgba(240,131,58,0.10), transparent 60%)',
          pointerEvents: 'none',
        }} />
        <Eyebrow>Due this month</Eyebrow>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 56, fontWeight: 500,
            letterSpacing: '-0.03em', color: 'var(--fg-1)',
            fontFeatureSettings: '"tnum" 1',
          }}>
            <span style={{ color: 'var(--fg-3)', fontSize: 36, marginRight: 6 }}>$</span>1,284.00
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: 'var(--fg-2)' }}>
          across {dueCount} bills · {paidThisMonth} already paid
        </div>
      </Card>

      <Card>
        <Eyebrow>Next up</Eyebrow>
        <div style={{ marginTop: 14, fontSize: 14, fontWeight: 500, color: 'var(--fg-1)' }}>Pacific Power</div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--fg-3)' }}>Due in 3 days · May 14</div>
        <div style={{ marginTop: 14 }}><Amount value={142.30} size="lg" /></div>
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" size="sm">Pay now</Button>
        </div>
      </Card>

      <Card>
        <Eyebrow>This year</Eyebrow>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <Amount value={9248.55} size="lg" />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-3)' }}>across 47 paid bills</div>
        <div style={{ marginTop: 14, height: 6, background: 'var(--surface-inset)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
          <div style={{ width: '38%', height: '100%', background: 'var(--brand)' }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>38% of last year's total</div>
      </Card>
    </div>
  );
}

function UpcomingList({ bills, onPay, onSelect }) {
  return (
    <Card padding={0}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-1)' }}>Upcoming</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>Next 14 days</div>
        </div>
        <Button variant="ghost" size="sm" icon="arrow-up-right">View all</Button>
      </div>
      <div>
        {bills.map(b => (
          <div key={b.id} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '14px 24px',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <VendorIcon kind={b.kind} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-1)' }}>{b.name}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                {b.dueDate}{b.autoPay ? ' · Auto-pay' : ''}
              </div>
            </div>
            <Badge tone={b.status === 'due' && b.daysUntilDue <= 3 ? 'due' : 'sched'}>
              {b.status === 'due' ? `Due in ${b.daysUntilDue} days` : 'Scheduled'}
            </Badge>
            <Amount value={b.amount} size="md" />
            {!b.autoPay && b.status === 'due' && (
              <Button variant="primary" size="sm" onClick={() => onPay && onPay(b)}>Pay</Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentlyPaid({ bills }) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-1)' }}>Recently paid</div>
      </div>
      {bills.map(b => (
        <div key={b.id} style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <VendorIcon kind={b.kind} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-1)' }}>{b.name}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{b.paidDate}</div>
          </div>
          <Amount value={b.amount} size="sm" muted />
        </div>
      ))}
    </Card>
  );
}

function Dashboard({ bills, onPay, onSelect }) {
  const upcoming = bills.filter(b => b.status === 'due' || b.status === 'sched');
  const paid = bills.filter(b => b.status === 'paid').slice(0, 4);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{
          fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em',
          color: 'var(--fg-1)', margin: 0,
        }}>Good morning, Partner</h1>
        <p style={{ marginTop: 6, color: 'var(--fg-2)', fontSize: 15 }}>
          You've got 4 bills coming up in the next two weeks.
        </p>
      </div>
      <HeroSummary total={1284} dueCount={4} paidThisMonth={3} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <UpcomingList bills={upcoming} onPay={onPay} onSelect={onSelect} />
        <RecentlyPaid bills={paid} />
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, HeroSummary, UpcomingList, RecentlyPaid });
