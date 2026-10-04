import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  width?: number | string;
  footer?: ReactNode;
};

export function Modal({ open, onClose, title, subtitle, children, width = 480, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        animation: "hearth-fade-in var(--dur-state) var(--ease)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-3)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-xl)",
          padding: 28,
          width,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          overflowY: "auto",
          boxShadow: "var(--shadow-modal)",
          animation: "hearth-pop-in var(--dur-enter) var(--ease)",
        }}
      >
        {(title || subtitle) && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              {title && (
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4 }}>{subtitle}</div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--fg-2)",
                padding: 6,
                borderRadius: "var(--r-md)",
                display: "inline-flex",
              }}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        )}
        {children}
        {footer && (
          <div style={{ marginTop: 24, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
