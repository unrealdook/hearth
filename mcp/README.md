# Hearth MCP server

Exposes your locally-hosted **Hearth Personal Finance** data to Claude (Claude
Desktop and Claude Code) as a set of **read-only tools**. Ask Claude about your
finances in plain language — net worth, upcoming bills, budget vs actual, debt
payoff, spending anomalies, and more — and it answers from your real data.

No API tokens and no extra LLM: this server runs no model and does the reasoning
through your existing Claude subscription. Your database and this server stay
entirely on your machine; only the answers to questions you ask travel to Claude
(the same as any Claude chat).

```
Claude (your subscription)  <-- stdio -->  hearth_mcp.py  <-- HTTP -->  Hearth API
                                                                        127.0.0.1:5274
```

## What it can read

28 read-only tools, including:

- **Overview** — `hearth_financial_summary`, `hearth_net_worth_history`
- **Bills & alerts** — `hearth_upcoming_bills`, `hearth_alerts`, `hearth_list_bills`
- **Spending** — `hearth_spending`, `hearth_budget_vs_actual`, `hearth_transactions`,
  `hearth_subscriptions`, `hearth_anomalies`
- **Cash flow & debt** — `hearth_cashflow_forecast`, `hearth_list_debts`,
  `hearth_debt_payoff_plan`
- **Income** — `hearth_income_report`, `hearth_list_income`, `hearth_income_events`
- **Accounts** — `hearth_cash_accounts`, `hearth_investments`, `hearth_retirement`
- **Utilities** — `hearth_usage_trends`, `hearth_usage_insights`
- **Side business** — `hearth_business_summary`, `hearth_business_projects`
- **Other** — `hearth_fico_scores`, `hearth_giving`

It **cannot** write, pay, mark bills paid, decrypt stored bill logins, or read
backups. The API key it uses is honoured by Hearth for `GET` requests only.

## One-time setup

### 1. Generate the read-only API key

From the project's `backend` directory:

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.cli gen-api-key
```

This writes `backend/data/.api_key` (gitignored). The MCP server reads that file
automatically, so you don't need to copy the key anywhere. (You can also set
`HEARTH_API_KEY` in the config below to override it.)

> The key is read-only and cannot decrypt your stored bill credentials. Rotate
> it anytime with `gen-api-key` again, or remove it with `revoke-api-key`.

### 2. Install the MCP server's dependencies

A dedicated virtualenv was created at `mcp/.venv`. If you need to recreate it:

```powershell
cd mcp
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 3. Register the server with Claude

Replace `<HEARTH_DIR>` with the absolute path to your clone (Claude Desktop's
config cannot resolve relative paths). Backslashes must be doubled in JSON.

**Make sure the Hearth backend is running** (run `start.bat`) whenever you want
Claude to read your data.

#### Claude Desktop

Edit `claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit
Config) and add a `hearth` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "hearth": {
      "command": "<HEARTH_DIR>\\mcp\\.venv\\Scripts\\python.exe",
      "args": ["<HEARTH_DIR>\\mcp\\hearth_mcp.py"]
    }
  }
}
```

Restart Claude Desktop. You should see the Hearth tools appear (the tools/plug
icon). The key and URL are picked up automatically; to override them, add:

```json
      "env": {
        "HEARTH_API_URL": "http://127.0.0.1:5274",
        "HEARTH_API_KEY": "hearth_xxx"
      }
```

#### Claude Code

```powershell
claude mcp add hearth ".\mcp\.venv\Scripts\python.exe" ".\mcp\hearth_mcp.py"
```

## Try it

With the backend running and Claude restarted, ask things like:

- "What's my net worth and how has it trended?"
- "Which bills are overdue or due in the next week?"
- "Am I over budget this month? Break it down by category."
- "If I put an extra $300/month toward debt, when am I debt-free — avalanche vs snowball?"
- "Any unusual spending or subscriptions I should look at?"

## Troubleshooting

- **"Could not reach the Hearth backend"** — start the app (`start.bat`); confirm
  it's on `http://127.0.0.1:5274` (`/api/health`).
- **"unauthorized" / key rejected** — set the app passcode at least once in the
  UI, then regenerate the key with `python -m app.cli gen-api-key`.
- **Tools don't appear in Claude** — check the command path in the config points
  at `mcp\.venv\Scripts\python.exe`, and fully restart Claude Desktop.
