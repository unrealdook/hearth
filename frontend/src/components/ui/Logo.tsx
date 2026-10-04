type Props = { size?: number; showWord?: boolean };

export function Logo({ size = 24, showWord = true }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--brand)" />
        <path
          d="M16 7.5c0 3.2 3.4 4.6 3.4 8.2 0 2.1-1.5 3.7-3.4 3.7s-3.4-1.6-3.4-3.7c0-1.7.8-2.7.8-4.1 0-1.6-1.2-2.6-1.2-2.6 1.6 0 2.4-.7 3.8-1.5z"
          fill="var(--surface-0)"
        />
        <path
          d="M11.2 18.5c-.6.9-1 2-1 3.1 0 3 2.6 5.4 5.8 5.4s5.8-2.4 5.8-5.4c0-1.1-.4-2.2-1-3.1.2.5.3 1 .3 1.6 0 2.3-2.3 4.2-5.1 4.2s-5.1-1.9-5.1-4.2c0-.6.1-1.1.3-1.6z"
          fill="var(--surface-0)"
        />
      </svg>
      {showWord && (
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--fg-1)",
          }}
        >
          Hearth
        </span>
      )}
    </div>
  );
}
