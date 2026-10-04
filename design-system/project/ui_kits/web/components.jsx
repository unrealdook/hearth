// Hearth UI Kit — shared components
// Globally exported via window.* for use across multiple babel scripts.

const { useState, useEffect, useRef } = React;

// ---------- Logo -----------------------------------------------------------
function Logo({ size = 28 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#F0833A"/>
        <path d="M16 7.5c0 3.2 3.4 4.6 3.4 8.2 0 2.1-1.5 3.7-3.4 3.7s-3.4-1.6-3.4-3.7c0-1.7.8-2.7.8-4.1 0-1.6-1.2-2.6-1.2-2.6 1.6 0 2.4-.7 3.8-1.5z" fill="#1A0E05"/>
        <path d="M11.2 18.5c-.6.9-1 2-1 3.1 0 3 2.6 5.4 5.8 5.4s5.8-2.4 5.8-5.4c0-1.1-.4-2.2-1-3.1.2.5.3 1 .3 1.6 0 2.3-2.3 4.2-5.1 4.2s-5.1-1.9-5.1-4.2c0-.6.1-1.1.3-1.6z" fill="#1A0E05"/>
      </svg>
      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--fg-1)' }}>Hearth</span>
    </div>
  );
}

// ---------- Icon -----------------------------------------------------------
function Icon({ name, size = 18, stroke = 1.5, color, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = '';
      const i = document.createElement('i');
      i.setAttribute('data-lucide', name);
      ref.current.appendChild(i);
      window.lucide.createIcons({ attrs: { 'stroke-width': stroke, width: size, height: size } });
    }
  }, [name, size, stroke]);
  return <span ref={ref} style={{ display: 'inline-flex', color: color || 'inherit', width: size, height: size, ...style }} />;
}

// ---------- Button ---------------------------------------------------------
function Button({ variant = 'primary', size = 'md', icon, children, onClick, style, ...rest }) {
  const base = {
    fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 500, lineHeight: 1, borderRadius: 'var(--r-lg)',
    transition: 'background var(--dur-micro) var(--ease), transform var(--dur-micro) var(--ease)',
  };
  const sizes = {
    sm: { padding: '6px 10px', fontSize: 13, borderRadius: 'var(--r-md)' },
    md: { padding: '10px 16px', fontSize: 14 },
    lg: { padding: '12px 20px', fontSize: 15 },
  };
  const variants = {
    primary: { background: 'var(--brand)', color: 'var(--brand-fg)' },
    secondary: { background: 'var(--surface-2)', color: 'var(--fg-1)', border: '1px solid var(--border-default)' },
    ghost: { background: 'transparent', color: 'var(--fg-1)' },
    danger: { background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border-default)' },
  };
  const [hover, setHover] = useState(false);
  const hoverBg = {
    primary: 'var(--brand-hover)',
    secondary: 'var(--surface-3)',
    ghost: 'var(--surface-2)',
    danger: 'var(--danger-soft)',
  }[variant];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...sizes[size], ...variants[variant], ...(hover ? { background: hoverBg } : {}), ...style }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} stroke={1.75} />}
      {children}
    </button>
  );
}

// ---------- Input ----------------------------------------------------------
function Input({ icon, prefix, value, onChange, placeholder, type = 'text', style }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--surface-inset)',
      border: `1px solid ${focus ? 'var(--brand)' : 'var(--border-default)'}`,
      boxShadow: focus ? '0 0 0 3px rgba(240,131,58,0.15)' : 'none',
      borderRadius: 'var(--r-md)', padding: '0 12px', height: 40, ...style,
    }}>
      {icon && <Icon name={icon} size={16} stroke={1.75} color="var(--fg-3)" />}
      {prefix && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', fontSize: 14 }}>{prefix}</span>}
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--fg-1)', fontFamily: 'inherit', fontSize: 14, flex: 1, height: '100%',
        }}
      />
    </div>
  );
}

// ---------- Badge ----------------------------------------------------------
function Badge({ tone = 'neutral', children, dot = true }) {
  const tones = {
    paid:    { bg: 'var(--success-soft)', fg: 'var(--success)' },
    due:     { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    overdue: { bg: 'var(--danger-soft)',  fg: 'var(--danger)'  },
    sched:   { bg: 'var(--info-soft)',    fg: 'var(--info)'    },
    neutral: { bg: 'var(--surface-2)',    fg: 'var(--fg-2)'    },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 'var(--r-full)',
      fontSize: 12, fontWeight: 500, lineHeight: 1.4,
      background: t.bg, color: t.fg,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.fg }} />}
      {children}
    </span>
  );
}

// ---------- Card -----------------------------------------------------------
function Card({ children, style, padding = 24 }) {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--r-lg)',
      padding,
      ...style,
    }}>{children}</div>
  );
}

// ---------- VendorIcon -----------------------------------------------------
const VENDOR_ICONS = {
  electric: 'zap', internet: 'wifi', water: 'droplet', gas: 'flame',
  rent: 'home', insurance: 'shield', subscription: 'play-circle',
  phone: 'smartphone', credit: 'credit-card',
};
function VendorIcon({ kind = 'electric', size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--r-md)',
      background: 'var(--surface-2)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      color: 'var(--fg-2)', flexShrink: 0,
    }}>
      <Icon name={VENDOR_ICONS[kind] || 'receipt'} size={Math.round(size * 0.5)} stroke={1.5} />
    </div>
  );
}

// ---------- Amount ---------------------------------------------------------
function Amount({ value, size = 'md', muted = false }) {
  const sizes = { sm: 14, md: 18, lg: 24, xl: 32, hero: 64 };
  const fmt = Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: sizes[size], fontWeight: size === 'hero' ? 500 : 500,
      letterSpacing: '-0.02em',
      fontFeatureSettings: '"tnum" 1',
      color: muted ? 'var(--fg-3)' : 'var(--fg-1)',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ color: muted ? 'var(--fg-4)' : 'var(--fg-3)', marginRight: 4 }}>$</span>{fmt}
    </span>
  );
}

// ---------- Switch ---------------------------------------------------------
function Switch({ on, onChange }) {
  return (
    <div onClick={() => onChange && onChange(!on)} style={{
      width: 36, height: 20, borderRadius: 'var(--r-full)',
      background: on ? 'var(--brand)' : 'var(--surface-3)',
      position: 'relative', cursor: 'pointer', flexShrink: 0,
      transition: 'background var(--dur-micro) var(--ease)',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: '50%',
        background: on ? 'var(--brand-fg)' : 'var(--fg-2)',
        transform: on ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease)',
      }} />
    </div>
  );
}

// ---------- Eyebrow --------------------------------------------------------
function Eyebrow({ children }) {
  return <div style={{
    fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--fg-2)',
  }}>{children}</div>;
}

Object.assign(window, {
  Logo, Icon, Button, Input, Badge, Card, VendorIcon, Amount, Switch, Eyebrow,
});
