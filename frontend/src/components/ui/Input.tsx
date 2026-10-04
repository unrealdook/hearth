import {
  CSSProperties, InputHTMLAttributes, useState, useRef, useEffect, useMemo,
  Children, isValidElement, ReactNode, ReactElement,
} from "react";
import * as Lucide from "lucide-react";

const ChevronDown = Lucide.ChevronDown;
const Check = Lucide.Check;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  icon?: keyof typeof Lucide;
  prefix?: string;
  containerStyle?: CSSProperties;
};

export function Input({ icon, prefix, containerStyle, style, ...rest }: Props) {
  const [focus, setFocus] = useState(false);
  const Icon = icon ? (Lucide[icon] as any) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--surface-inset)",
        border: `1px solid ${focus ? "var(--brand)" : "var(--border-default)"}`,
        boxShadow: focus ? "0 0 0 3px var(--brand-ring)" : "none",
        borderRadius: "var(--r-md)",
        padding: "0 12px",
        height: 40,
        ...containerStyle,
      }}
    >
      {Icon && <Icon size={16} strokeWidth={1.75} color="var(--fg-3)" />}
      {prefix && (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-3)", fontSize: 14 }}>
          {prefix}
        </span>
      )}
      <input
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--fg-1)",
          fontFamily: "inherit",
          fontSize: 14,
          flex: 1,
          height: "100%",
          minWidth: 0,
          colorScheme: "dark",
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  containerStyle?: CSSProperties;
};

export function Textarea({ containerStyle, style, rows = 3, ...rest }: TextareaProps) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        background: "var(--surface-inset)",
        border: `1px solid ${focus ? "var(--brand)" : "var(--border-default)"}`,
        boxShadow: focus ? "0 0 0 3px var(--brand-ring)" : "none",
        borderRadius: "var(--r-md)",
        padding: "8px 12px",
        ...containerStyle,
      }}
    >
      <textarea
        rows={rows}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--fg-1)",
          fontFamily: "inherit",
          fontSize: 14,
          flex: 1,
          resize: "vertical",
          minHeight: 60,
          lineHeight: 1.5,
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  containerStyle?: CSSProperties;
};

/**
 * Custom dropdown — replaces native <select> so the popup matches the dark Hearth tokens.
 * Same API as native: <Select value=... onChange={(e) => ...e.target.value}>
 *   <option value="x">Label</option>
 * </Select>
 * Also supports `disabled` on options.
 */
export function Select({ containerStyle, style, children, value, onChange, disabled, name, id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // extract options from <option> children
  const options = useMemo(() => {
    const out: { value: string; label: ReactNode; disabled?: boolean }[] = [];
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      if ((child.type as any) !== "option") return;
      const props = (child as ReactElement<any>).props;
      const optValue = props.value !== undefined ? String(props.value) : String(props.children ?? "");
      out.push({ value: optValue, label: props.children, disabled: !!props.disabled });
    });
    return out;
  }, [children]);

  const selected = options.find((o) => o.value === String(value ?? ""));

  // close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") { e.preventDefault(); setHoverIdx((i) => Math.min(options.length - 1, i + 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHoverIdx((i) => Math.max(0, i - 1)); }
      if (e.key === "Enter" && hoverIdx >= 0) {
        e.preventDefault();
        const o = options[hoverIdx];
        if (!o.disabled) commit(o.value);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, hoverIdx, options]);

  function commit(v: string) {
    setOpen(false);
    if (!onChange) return;
    // synthesize a partial change event so callers using `e.target.value` still work
    const evt = { target: { value: v, name } } as unknown as React.ChangeEvent<HTMLSelectElement>;
    onChange(evt);
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        ...containerStyle,
      }}
    >
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
          const i = options.findIndex((o) => o.value === String(value ?? ""));
          setHoverIdx(i >= 0 ? i : 0);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "var(--surface-inset)",
          border: `1px solid ${open ? "var(--brand)" : "var(--border-default)"}`,
          boxShadow: open ? "0 0 0 3px var(--brand-ring)" : "none",
          borderRadius: "var(--r-md)",
          padding: "0 12px",
          height: 40,
          color: "var(--fg-1)",
          fontFamily: "inherit",
          fontSize: 14,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          ...style,
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : <span style={{ color: "var(--fg-3)" }}>Select…</span>}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          color="var(--fg-3)"
          style={{
            transition: "transform var(--dur-micro) var(--ease)",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-overlay)",
            padding: 4,
            zIndex: 200,
            maxHeight: 280,
            overflowY: "auto",
            animation: "hearth-pop-in var(--dur-state) var(--ease)",
          }}
        >
          {options.map((o, i) => {
            const isSelected = o.value === String(value ?? "");
            const isHover = i === hoverIdx;
            return (
              <button
                key={o.value + i}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={o.disabled}
                onMouseEnter={() => setHoverIdx(i)}
                onClick={() => !o.disabled && commit(o.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: 13,
                  textAlign: "left",
                  border: "none",
                  borderRadius: "var(--r-sm)",
                  background: isHover && !o.disabled
                    ? "var(--surface-3)"
                    : isSelected
                    ? "var(--ember-700)"
                    : "transparent",
                  color: o.disabled
                    ? "var(--fg-4)"
                    : isSelected
                    ? "var(--ember-100)"
                    : "var(--fg-1)",
                  cursor: o.disabled ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {isSelected && <Check size={14} strokeWidth={2} color="var(--ember-200)" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type FieldProps = {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: CSSProperties;
};

export function Field({ label, hint, children, style }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{hint}</div>}
    </div>
  );
}
