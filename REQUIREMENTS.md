# Personal Finance Tracker — Requirements

**Version:** 1.0
**License:** Use and adapt freely.

---

## 1. Overview

A locally hosted, single-user personal finance web application — designed to replace a manually maintained spreadsheet. The app tracks bills, payments, income, debt, savings, investments, and spending analytics, and ships with AI-powered insights via a locally running LLM (Ollama).

The product runs entirely on the user's own machine. No cloud sync, no third-party services, no telemetry. The only network call leaving the box is to a local Ollama instance on `localhost`.

---

## 2. Tech Stack

- **Backend:** Python — Flask (preferred) or any minimal WSGI framework
- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS, with design tokens supplied by a separate design system bundle (see §10)
- **Database:** SQLite (local, no server) — straightforward to upgrade to PostgreSQL later
- **AI / LLM:** Ollama running locally (e.g. Qwen 2.5, Llama 3.x) via REST at `http://localhost:11434`
- **Authentication:** Local single-user **4-digit passcode**. The passcode also derives (via PBKDF2) the Fernet key used to encrypt stored bill credentials — unlock and credential-vault unlock are unified.
- **File parsing:** Python stdlib `csv` for CSV, `pdfplumber` for PDF
- **Credential storage:** `cryptography.Fernet`. Key derived from the passcode + a per-app salt; never persisted to disk.
- **Charting:** Recharts (or Chart.js)
- **Icons:** Lucide

---

## 3. Data Model

### 3.1 Bill / Recurring Payment

| Field | Type | Description |
|---|---|---|
| id | int | Primary key |
| category | string | Loans, Mortgage, Monthly Bills, Variable, Subscriptions, Other |
| name | string | Display name (e.g. "Electric", "Streaming service") |
| amount | decimal | Current monthly amount |
| credit_limit | decimal | Optional, for credit-line products |
| due_day | int | Day of month, 1–31 |
| term_months | int | Optional, for term loans |
| notes | string | Freeform notes (account numbers, reminders) |
| payment_url | string | Direct link to the biller's payment page |
| username | string | **Stored encrypted** |
| password | string | **Stored encrypted** |
| is_autopay | bool | Whether payment is automatic |
| is_active | bool | Whether the bill is currently active |
| kind | string | Vendor type for the icon (electric, internet, water, etc.) |

**Suggested categories** to seed:
- Loans (auto, personal, student loans by servicer)
- Mortgage / Second mortgage
- Monthly Bills (electric, gas, water, sewage/trash, internet, cell phone, insurance)
- Variable (groceries, fuel, credit-card payments)
- Subscriptions (streaming, music, AI services, gym, union dues)
- Other (allowances, miscellaneous recurring items)

### 3.2 Monthly Payment Record

| Field | Type | Description |
|---|---|---|
| id | int | Primary key |
| bill_id | int | FK → Bill |
| month | int | 1–12 |
| year | int | e.g. 2026 |
| amount_paid | decimal | Actual amount paid (may differ from default) |
| paid | bool | Whether this bill was paid this month |
| paid_date | datetime | Timestamp when marked paid |
| notes | string | Optional |

Unique constraint on `(bill_id, month, year)` — one record per bill per month.

### 3.3 Income

| Field | Type | Description |
|---|---|---|
| id | int | Primary key |
| source | string | Free-form label (e.g. "Primary earner", "Side income") |
| amount | decimal | Amount received |
| frequency | string | `monthly`, `per_check`, `annual` |
| type | string | `salary`, `side_income`, `dividend` |
| month | int | Optional, month received |
| year | int | Optional, year received |

### 3.4 Debt

| Field | Type | Description |
|---|---|---|
| id | int | Primary key |
| name | string | Display name |
| debt_amount | decimal | Outstanding balance |
| asset_value | decimal | Current value of underlying asset (if any) |
| interest_rate | decimal | Annual % |
| monthly_payment | decimal | Required monthly payment |
| category | string | `mortgage`, `auto`, `student`, `credit_card`, `personal`, `other` |
| notes | string | Optional |

### 3.5 Assets / Savings / Investments

Three small tables sharing a "net worth" surface:
- **Savings accounts** — named cash accounts (checking, savings, named buckets like "house fund")
- **Investments** — equities, REITs, managed accounts, cash equivalents, real estate
- **Retirement** — 401k / IRA: balance, contribution %, employer match %, projected growth %

Plus an **Owed-to-me** table for tracking informal money lent out (name, amount, notes).

### 3.6 Budget Allocation

Configurable percentages, **Live / Invest / Save / Debt** (default 70 / 10 / 10 / 10). Optionally tracked per income source. Auto-computes monthly and annual dollar targets from gross.

### 3.7 FICO / Credit Score

Manual entry: score value, date recorded, score model name (e.g. "FICO Score 8"). History retained for the trend chart.

### 3.8 Imported Transactions (Bank Statement)

| Field | Type | Description |
|---|---|---|
| id | int | Primary key |
| date | date | Transaction date |
| description | string | Raw description |
| amount | decimal | Signed (debit negative, credit positive) |
| category | string | AI-assigned or user-edited |
| type | string | `debit` or `credit` |
| source_file | string | Original imported filename |
| matched_bill_id | int | FK → Bill if auto-matched |
| confirmed | bool | User confirmed the row on import |
| fingerprint | string (unique) | Hash of `date|description|amount` for dedupe |

---

## 4. Feature Requirements

### 4.1 Dashboard
- Hero summary: total due this month, count of bills, count already paid
- Greeting + plain-English status line ("you've got 4 bills coming up")
- Net worth panel (cash + investments + retirement + asset value − debt)
- Upcoming list (next 14 days), with "Pay" buttons for non-autopay bills
- FICO score quick-view with last-updated date

### 4.2 Bills Management
- **List view**: grouped by category, with Name, Amount, Due day, Auto-pay flag, Edit
- **Detail panel**: slides in from the right; shows full details, payment history, "Pay" flow
- **Editor**: full CRUD with all fields editable
- **Pay flow**: opens the biller's URL in a new tab, lets the user confirm the actual amount, then records the payment
- **Encrypted credentials**: stored Fernet-encrypted; revealed via "show/hide" toggle and copy-to-clipboard buttons inside the detail panel

### 4.3 Monthly Payment Tracker
- Per-month grid of every bill, with paid / unpaid status
- One-click toggle paid/unpaid; per-occurrence amount editing
- Month navigation (◀ / ▶)
- Totals: total this month, paid, remaining

### 4.4 Income Tracking
- Log income per source per month
- Per-paycheck and monthly summary views
- Annual gross income history chart (with projected future years)
- Budget allocation editor (Live/Invest/Save/Debt %), with live $-equivalent of each slice based on current monthly income

### 4.5 Debt Tracker
- Full breakdown: balance, asset value, interest rate, monthly payment, category
- Auto-calculated **Net Worth** = Total Asset Values − Total Debt Balances
- Visual flag for debts with no backing asset (warning icon next to credit cards, student loans, etc.)
- AI-assisted payoff projections (avalanche / snowball)

### 4.6 Savings & Investment Tracker
- Named savings buckets with current balances
- Investment accounts (with optional ticker)
- Retirement: contribution %, employer match %, projected growth at configurable rate
- "Owed to me" section for tracking informal loans

### 4.7 Bank Statement Import
- Accepts CSV and PDF (CSV is the primary target — Chase format works out of the box)
- Parses date, description, amount, debit/credit type
- AI (local Ollama) auto-categorizes each transaction; falls back to a rule-based stub if Ollama is unreachable
- Auto-matches transactions to existing bills using a name/amount scoring heuristic
- Manual review UI before saving — categories editable, "mark paid" toggle per matched row
- Bills automatically marked paid when a matching transaction is confirmed
- Duplicate detection via per-row fingerprint hash

### 4.8 Spending Analytics
- Spending by category (pie + bar)
- Month-over-month trends per category
- Monthly cashflow chart (income vs. total outflows)
- Year-over-year totals
- Net worth trajectory

### 4.9 AI Assistant
Persistent chat panel. Connects to local Ollama at `POST http://localhost:11434/api/chat`. Current financial state (active bills, debts, totals, savings) is injected as a system message with each request.

**Suggested capabilities:**
- "Which bills increased the most over the past 6 months?"
- "How much would I save if I cut [X], [Y], [Z]?"
- Debt payoff order (avalanche vs. snowball)
- Monthly savings goal projections from current income & expenses
- Spending anomaly detection ("your electric bill is 40% above your 6-month average")
- Net worth trajectory at 1, 3, and 5 years
- Free-form Q&A

All conversations saved with question, response, and timestamp.

### 4.10 Credential Vault
- Fernet-encrypted username + password per bill
- Master 4-digit passcode → PBKDF2 → Fernet key. Key lives only in the in-memory session.
- Passwords masked in the UI by default; show/hide toggle and copy buttons in the bill detail panel
- Strictly local — credentials never leave the machine

### 4.11 FICO Score History
- Manual entry: score, date, model name, optional notes
- Line chart of trajectory
- Tier badge ("Exceptional", "Very good", "Good", "Fair", "Poor")

---

## 5. Application Structure

```
/app
  /backend
    app/
      __init__.py            # app factory, blueprint registration
      cli.py                 # `python -m app.cli init-db`
      models/entities.py     # SQLAlchemy models
      routes/                # auth, bills, payments, income, debt, savings, imports,
                             # analytics, ai, fico, credentials, budget
      services/
        auth.py              # 4-digit passcode hashing, session, key derivation
        encryption.py        # Fernet wrapper
        ollama_client.py     # Ollama REST wrapper
        parser.py            # CSV + PDF bank statement parsing
        matching.py          # transaction → bill scoring
    data/                    # finance.db, .salt, auth.json — gitignored
    imports/                 # uploaded statements — gitignored
    requirements.txt
    run.py                   # binds to 127.0.0.1 only
    .env.example

  /frontend
    src/
      App.tsx                # auth gate + router
      main.tsx
      styles/hearth.css      # ported design tokens (or your own design system)
      components/ui/         # Button, Input, Card, Badge, Switch, Amount,
                             # VendorIcon, Modal, Eyebrow, Logo, EmptyState, Spinner
      layout/                # TopBar, SideNav, AppShell
      pages/                 # Dashboard, Bills, Payments, Income, Debt, Savings,
                             # Import, Analytics, AIInsights, Fico, Settings, LockScreen
      lib/                   # api wrapper, format helpers, reference data
      hooks/                 # useAuth (loading/needs_setup/locked/unlocked)
    tailwind.config.js
    vite.config.ts
    index.html

  /design-system             # design system bundle (read-only reference)
  start.bat / start.sh
  README.md
  .gitignore
```

---

## 6. API Endpoints (Flask)

All endpoints under `/api/*` (except `/health` and `/auth/*`) require an `X-Hearth-Session` header carrying the bearer token returned from `/auth/unlock` or `/auth/setup`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Liveness + auth-configured flag |
| GET | `/api/auth/status` | Whether passcode has been set |
| POST | `/api/auth/setup` | Set initial passcode |
| POST | `/api/auth/unlock` | Verify passcode, get session token |
| POST | `/api/auth/lock` | Revoke the current session |
| POST | `/api/auth/change-passcode` | Change passcode (invalidates encrypted credentials) |
| GET / POST | `/api/bills` | List / create |
| GET / PUT / DELETE | `/api/bills/<id>` | Read / update / delete |
| GET / POST | `/api/payments` | List / create or upsert per (bill, month, year) |
| PUT / DELETE | `/api/payments/<id>` | Update / delete |
| GET / POST / PUT / DELETE | `/api/income[/<id>]` | CRUD |
| GET / POST / PUT / DELETE | `/api/debt[/<id>]` | CRUD |
| GET / POST / PUT / DELETE | `/api/savings/accounts[/<id>]` | CRUD |
| GET / POST / PUT / DELETE | `/api/savings/investments[/<id>]` | CRUD |
| GET / POST / PUT / DELETE | `/api/savings/retirement[/<id>]` | CRUD |
| GET / POST / PUT / DELETE | `/api/savings/owed[/<id>]` | CRUD |
| POST | `/api/import/bank-statement` | Upload + parse + AI-categorize |
| POST | `/api/import/confirm` | Persist user-reviewed rows |
| GET | `/api/import/transactions` | Recent imported transactions |
| GET | `/api/analytics/summary` | Dashboard hero data |
| GET | `/api/analytics/upcoming` | Bills due in current month |
| GET | `/api/analytics/mom` | Month-over-month per bill |
| GET | `/api/analytics/yoy` | Year-over-year totals |
| GET | `/api/analytics/spending` | Spending category breakdown |
| GET | `/api/analytics/cashflow` | Monthly income vs. outflow |
| GET | `/api/analytics/networth` | Cash + investments + retirement − debt |
| POST | `/api/ai/chat` | Send prompt to Ollama with current financial context |
| GET | `/api/ai/history` | Past Q&A |
| GET | `/api/ai/status` | Ollama reachable + model in use |
| GET | `/api/credentials/<bill_id>` | Decrypted credentials for a bill |
| GET / POST | `/api/fico` | List / create FICO entries |
| DELETE | `/api/fico/<id>` | Delete |
| GET / POST | `/api/budget` | List / upsert budget allocations |

---

## 7. Security Considerations

- All bill credentials encrypted at rest with `cryptography.fernet`
- Fernet key derived from the user's 4-digit passcode + a per-app salt via PBKDF2 (200k iterations); the key lives **only in memory** inside the active session — it is never written to disk
- The salt file is auto-generated on first run and stored next to the database
- Flask binds to `127.0.0.1` only — no external network exposure
- No third-party services for any sensitive data
- `.gitignore` excludes `.env`, `.keyfile`, `.salt`, `auth.json`, `data/finance.db`, `imports/`
- Threat model assumes a single trusted user on a personal machine. A 4-digit passcode is intentionally lightweight; it gates casual access but is not a defense against a determined attacker with disk access. Treat the device itself as the security boundary.

---

## 8. Out of Scope (v1.0)

- Multi-user / multi-household support
- Native mobile apps (responsive web is fine)
- Automatic bill payment execution (the pay flow is informational + manual confirm only)
- Direct bank API integration (Plaid, MX, etc.)
- Cloud sync, remote access, off-device backup

---

## 9. Future Enhancements (v2.0+)

- Plaid / MX integration for automatic transaction sync
- Push or email reminders for upcoming due dates
- Multi-user / household profiles with separate views
- Scheduled monthly PDF report generation
- Financial goal tracking ("pay off card X by December")
- Mobile PWA wrapper for phone access on the local network
- Investment performance vs. benchmarks (S&P 500, etc.)
- Debt payoff scenario modeling (compare strategies side-by-side)

---

## 10. Design system workflow (Claude Design + Claude Code)

This project was implemented end-to-end by **Claude Code**, working from a design bundle generated in **Claude Design** (claude.ai/design). If you're building something similar, this is a workflow worth knowing.

### 10.1 The bundle

A Claude Design bundle is a tarball containing:
- `README.md` — instructions to the implementing coding agent ("read the chat transcripts first, then the design files")
- `chats/` — the conversation transcripts where the design was iterated. **Read these first** — they explain *intent*, not just output.
- `project/` — design tokens, HTML/CSS prototype files, the UI kit, brand assets

The agent's job is to **recreate the visuals pixel-perfectly in the target stack** (React/Tailwind in this case), not copy the prototype's internal structure.

### 10.2 What the design bundle should give you

Whether you generate one with Claude Design or write your own, ship at least:

- **A token file** (CSS variables) with surfaces, foreground colors, brand color, semantic colors (success/warning/danger/info), spacing scale, radius scale, shadow tokens, motion durations + easings, focus ring
- **A README** describing voice/copy rules, casing, currency formatting, empty-state philosophy, error-message philosophy
- **A UI kit** showing the canonical component shapes (buttons, inputs, cards, badges, modals, nav)
- **Logo / mark** as an SVG that uses the token color (so it auto-updates if the brand color changes)

### 10.3 Implementation tips

- **Port the tokens to a single CSS file**, then expose them in Tailwind's `theme.extend.colors` as `var(--token)`. You get Tailwind utilities and design-system tokens at once.
- **Inline-style components are fine** for a prototype-fidelity recreation. Don't over-engineer with utility-first Tailwind classes if the design system uses inline styles in the prototype — the result is identical and the diff against the prototype is easier to read.
- **Don't use emoji as icons.** Use Lucide (or whatever icon set the design system specifies) at the prescribed stroke width and size.
- **Numerics get a monospace font** with `font-feature-settings: 'tnum' 1` so columns of dollar amounts stay aligned.
- **Cards are bordered, not shadowed** — only overlays (popovers, modals) get shadows. Elevation comes from luminance steps in the surface ladder, not from saturation.
- **Match the voice.** If the design system says "calm, second-person, sentence case, no emoji," every empty state, error message, and modal title should follow it. This is the part that an LLM will silently violate if not reminded — keep the rules in the agent's working context.

### 10.4 Letting an agent build it for you

If you're handing this requirements doc to a coding agent (Claude Code, Aider, Cursor, etc.):

1. Drop both this `REQUIREMENTS.md` and your design system bundle into the project root.
2. Ask the agent to read the design system's README + chat transcripts before writing any UI code. The voice and visual rules live there.
3. Be explicit about non-obvious decisions: 4-digit passcode vs. master password, which Ollama model, whether to seed sample data, whether the frontend should be built immediately or wait for separate Artifact-generated designs.
4. Expect the agent to ask clarifying questions before starting. If it dives in without asking, push back — the cost of clarifying scope up front is much lower than rebuilding the wrong thing.
5. Ask for verification at the end: TypeScript clean? Backend imports without errors? Dev server starts? The agent should be willing to actually run these checks, not just claim success.

---

## 11. First-launch flow (for users)

1. Start the backend (`python run.py`) and the frontend (`npm run dev`).
2. Open the frontend URL in a browser.
3. The lock screen prompts for a 4-digit passcode — enter it twice to confirm.
4. From here, every reload requires the passcode. The same passcode unlocks the encrypted credential vault.
5. Add bills, income, debt, savings — manually or by importing a bank statement.

If the passcode is forgotten: delete the database and salt files (`data/finance.db`, `data/.salt`, `data/auth.json`) to reset. Bill credentials stored before the reset will be unrecoverable; everything else is rebuilt by re-importing or re-entering.

---

*End of requirements document.*
