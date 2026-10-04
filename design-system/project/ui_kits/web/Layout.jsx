// Layout shell: top bar + side nav + content area.
const { useState: useState_layout } = React;

function TopBar({ onSearch }) {
  return (
    <header style={{
      height: 56, borderBottom: '1px solid var(--border-subtle)',
      background: 'rgba(11,12,14,0.8)', backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', padding: '0 24px',
      gap: 24, position: 'sticky', top: 0, zIndex: 10,
    }}>
      <Logo size={24} />
      <div style={{ flex: 1, maxWidth: 360 }}>
        <Input icon="search" placeholder="Find a bill or vendor" value="" onChange={() => {}} />
      </div>
      <div style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" icon="bell">2</Button>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: 'var(--ember-700)',
        color: 'var(--ember-100)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 600,
      }}>JM</div>
    </header>
  );
}

function SideNav({ active, onNavigate }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
    { id: 'bills', label: 'Bills', icon: 'receipt', count: 7 },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'accounts', label: 'Accounts', icon: 'wallet' },
    { id: 'reminders', label: 'Reminders', icon: 'bell', count: 2 },
  ];
  return (
    <nav style={{
      width: 240, padding: '20px 16px', borderRight: '1px solid var(--border-subtle)',
      background: 'var(--surface-0)', display: 'flex', flexDirection: 'column', gap: 4,
      flexShrink: 0,
    }}>
      <div style={{ padding: '8px 12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
        Household
      </div>
      {items.map(it => (
        <NavItem key={it.id} item={it} active={active === it.id} onClick={() => onNavigate(it.id)} />
      ))}
      <div style={{ flex: 1 }} />
      <NavItem item={{ id: 'settings', label: 'Settings', icon: 'settings' }} active={active === 'settings'} onClick={() => onNavigate('settings')} />
    </nav>
  );
}

function NavItem({ item, active, onClick }) {
  const [hover, setHover] = useState_layout(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 12px', borderRadius: 'var(--r-md)',
        fontSize: 14, fontWeight: 500,
        color: active ? 'var(--fg-1)' : 'var(--fg-2)',
        background: (active || hover) ? 'var(--surface-2)' : 'transparent',
        cursor: 'pointer',
        transition: 'background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease)',
      }}
    >
      <Icon name={item.icon} size={18} stroke={1.75} color={active ? 'var(--brand)' : 'var(--fg-2)'} />
      <span>{item.label}</span>
      {item.count != null && (
        <span style={{
          marginLeft: 'auto', fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: active ? 'var(--ember-200)' : 'var(--fg-3)',
          background: active ? 'var(--ember-700)' : 'var(--surface-3)',
          padding: '2px 7px', borderRadius: 'var(--r-full)',
        }}>{item.count}</span>
      )}
    </div>
  );
}

Object.assign(window, { TopBar, SideNav, NavItem });
