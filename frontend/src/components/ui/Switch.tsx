type Props = { on: boolean; onChange: (next: boolean) => void; disabled?: boolean };

export function Switch({ on, onChange, disabled }: Props) {
  return (
    <div
      role="switch"
      aria-checked={on}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!on)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!on);
        }
      }}
      style={{
        width: 36,
        height: 20,
        borderRadius: "var(--r-full)",
        background: on ? "var(--brand)" : "var(--surface-3)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--dur-micro) var(--ease)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: on ? "var(--brand-fg)" : "var(--fg-2)",
          transform: on ? "translateX(16px)" : "translateX(0)",
          transition:
            "transform var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease)",
        }}
      />
    </div>
  );
}
