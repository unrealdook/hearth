// Reference data — bill categories and vendor-icon mapping.
// Kept here so the UI knows which categories to group by and which icon to show.

export const BILL_CATEGORIES = [
  "Loans",
  "Mortgage",
  "2nd Mortgage",
  "Monthly Bills",
  "Variable",
  "Subscriptions",
  "Other",
] as const;

export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const VENDOR_KINDS = [
  { value: "electric",     label: "Electric" },
  { value: "gas",          label: "Gas" },
  { value: "water",        label: "Water" },
  { value: "internet",     label: "Internet" },
  { value: "phone",        label: "Phone" },
  { value: "rent",         label: "Mortgage / Rent" },
  { value: "insurance",    label: "Insurance" },
  { value: "subscription", label: "Subscription" },
  { value: "credit",       label: "Credit card" },
  { value: "loan",         label: "Loan" },
  { value: "other",        label: "Other" },
] as const;

export type VendorKind = (typeof VENDOR_KINDS)[number]["value"];
