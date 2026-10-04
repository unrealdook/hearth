export type Bill = {
  id: number;
  category: string;
  name: string;
  amount: number;
  credit_limit: number | null;
  balance_remaining: number | null;
  due_day: number | null;
  term_months: number | null;
  notes: string | null;
  payment_url: string | null;
  is_autopay: boolean;
  is_active: boolean;
  /** Day it stopped being owed, or null. */
  paid_off_on: string | null;
  /** active | paused | paid_off (closed out) | paid_off_open (cleared, still live) */
  status: "active" | "paused" | "paid_off" | "paid_off_open";
  kind: string;
  usage_unit: string | null;
  has_credentials: boolean;
};

export const EMPTY_BILL: Partial<Bill> & { username?: string; password?: string } = {
  category: "Monthly Bills",
  name: "",
  amount: 0,
  due_day: 1,
  is_autopay: false,
  is_active: true,
  kind: "other",
};
