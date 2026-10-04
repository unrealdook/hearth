# Hearth — Web App UI Kit

Pixel-fidelity recreation of the Hearth web app. This is a click-through prototype, not production code — interactions feel real but state is in-memory.

## Files
- `index.html` — entry point. Boots the app.
- `components.jsx` — primitives: `Logo`, `Icon`, `Button`, `Input`, `Badge`, `Card`, `VendorIcon`, `Amount`, `Switch`, `Eyebrow`.
- `Layout.jsx` — `TopBar`, `SideNav`, `NavItem`.
- `BillList.jsx` — `BillRow`, `BillList` (the canonical bills table).
- `Dashboard.jsx` — `Dashboard`, `HeroSummary`, `UpcomingList`, `RecentlyPaid`.
- `BillDetail.jsx` — sliding right-side detail panel with payment history.
- `AddBillModal.jsx` — modal for creating a new bill.

## What's interactive
- Side-nav routes between Dashboard, Bills, Calendar, Accounts, Reminders, Settings.
- "Pay" buttons mark a bill paid and update the dashboard totals.
- The "+" floating button opens the Add Bill modal; submitting appends a new bill.
- Clicking any bill row opens the right-side detail panel.
- Settings toggles flip live.

## What's faked
- No real auth, no real bank links, no real payments. This is a UI shell.
- Calendar is a single static month.
- Charts are presentational only.
