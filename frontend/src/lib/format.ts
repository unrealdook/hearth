export function fmtMoney(n: number | null | undefined, decimals = 2): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtMoneyCompact(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return v.toFixed(0);
}

/**
 * Parse a YYYY-MM-DD ISO date as a *local* date, not UTC.
 * Plain `new Date("2026-05-01")` parses as UTC midnight, which displays
 * as the previous day in any timezone west of UTC. Date-only values from
 * the backend should be rendered on whatever calendar day they're labelled.
 */
function parseLocal(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
}

export function fmtDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parseLocal(iso);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtMonthDay(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parseLocal(iso);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ordinalDay(n: number | null | undefined): string {
  if (!n) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
