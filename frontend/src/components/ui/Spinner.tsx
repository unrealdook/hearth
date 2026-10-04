export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        width: size,
        height: size,
        border: "2px solid var(--border-default)",
        borderTopColor: "var(--brand)",
        borderRadius: "50%",
        animation: "hearth-spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes hearth-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
