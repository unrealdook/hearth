#!/usr/bin/env python3
"""
Hearth Personal Finance MCP server.

Exposes your locally-hosted Hearth finance data to Claude (Claude Desktop /
Claude Code) as a set of READ-ONLY tools. The server itself runs no model and
holds no secrets beyond a scoped, read-only API key — Claude does all the
reasoning, billed against your existing subscription. No API tokens, no cloud.

Architecture:
    Claude (subscription)  <-- stdio -->  this server  <-- HTTP -->  Hearth API
                                                                     127.0.0.1:5274

Auth:
    Hearth normally requires an X-Hearth-Session token derived from the 4-digit
    passcode. This server instead uses a scoped read-only API key
    (X-Hearth-Api-Key) that Hearth honours for GET requests only and which
    cannot decrypt stored bill credentials. Generate it once with:
        cd backend && python -m app.cli gen-api-key

Configuration (environment variables):
    HEARTH_API_URL   Base URL of the Hearth backend. Default http://127.0.0.1:5274
    HEARTH_API_KEY   The read-only API key. If unset, the server reads it from
                     ../backend/data/.api_key relative to this file.

Every tool is read-only. The server never writes, pays, or mutates anything.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional

import httpx

# Keep stderr clean — httpx logs every request at INFO, which Claude Desktop
# would surface as MCP log noise. The protocol travels over stdout regardless.
logging.getLogger("httpx").setLevel(logging.WARNING)
from pydantic import BaseModel, ConfigDict, Field
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("hearth_mcp")

# --------------------------------------------------------------------------- #
# Configuration & shared HTTP plumbing
# --------------------------------------------------------------------------- #

API_URL = os.environ.get("HEARTH_API_URL", "http://127.0.0.1:5274").rstrip("/")
_DEFAULT_KEY_FILE = Path(__file__).resolve().parent.parent / "backend" / "data" / ".api_key"
REQUEST_TIMEOUT = 30.0

# Common read-only annotations reused by every tool.
_RO = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}


def _api_key() -> Optional[str]:
    """Resolve the read-only API key from env, falling back to the key file."""
    env = os.environ.get("HEARTH_API_KEY")
    if env and env.strip():
        return env.strip()
    try:
        if _DEFAULT_KEY_FILE.exists():
            return _DEFAULT_KEY_FILE.read_text(encoding="utf-8").strip() or None
    except OSError:
        pass
    return None


async def _get(path: str, params: Optional[dict] = None) -> str:
    """GET a Hearth API endpoint with the read-only key and return JSON text.

    Returns a JSON string on success, or a JSON object {"error": ...} with an
    actionable message on failure, so the model always receives valid JSON.
    """
    key = _api_key()
    if not key:
        return json.dumps({
            "error": "no_api_key",
            "message": (
                "No Hearth API key found. Set HEARTH_API_KEY, or run "
                "'python -m app.cli gen-api-key' in the backend directory to "
                "create backend/data/.api_key."
            ),
        })

    url = f"{API_URL}/api{path}"
    headers = {"X-Hearth-Api-Key": key}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params=params or {}, headers=headers,
                                    timeout=REQUEST_TIMEOUT)
    except httpx.ConnectError:
        return json.dumps({
            "error": "connection_failed",
            "message": (
                f"Could not reach the Hearth backend at {API_URL}. Make sure "
                "the app is running (start.bat) and HEARTH_API_URL is correct."
            ),
        })
    except httpx.TimeoutException:
        return json.dumps({"error": "timeout",
                           "message": "The Hearth backend did not respond in time."})

    if resp.status_code == 401:
        return json.dumps({
            "error": "unauthorized",
            "message": (
                "The Hearth API key was rejected (invalid, or the app's passcode "
                "is not yet set). Regenerate it with 'python -m app.cli gen-api-key'."
            ),
        })
    if resp.status_code == 403:
        return json.dumps({"error": "forbidden",
                           "message": "This endpoint is not available to the read-only key."})
    if resp.status_code >= 400:
        return json.dumps({"error": f"http_{resp.status_code}", "message": resp.text[:500]})

    # Pass the API's JSON straight through (re-dumped so the model gets clean text).
    try:
        return json.dumps(resp.json(), indent=2, default=str)
    except ValueError:
        return resp.text


# --------------------------------------------------------------------------- #
# Input models
# --------------------------------------------------------------------------- #

class _NoArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BudgetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: str = Field(
        default="month",
        description="Budget window: 'month' (current month) or 'ytd' (year to date).",
        pattern="^(month|ytd)$",
    )


class DebtPayoffInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extra: float = Field(
        default=0.0,
        description="Extra dollars per month applied on top of minimum payments "
                    "in the payoff simulation (avalanche vs snowball).",
        ge=0,
    )


class DigestMonthInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    year: Optional[int] = Field(default=None, description="Calendar year, e.g. 2026. Omit for latest.", ge=2000, le=2100)
    month: Optional[int] = Field(default=None, description="Month number 1-12. Omit for latest.", ge=1, le=12)


# --------------------------------------------------------------------------- #
# Overview & net worth
# --------------------------------------------------------------------------- #

@mcp.tool(name="hearth_financial_summary", annotations={"title": "Financial summary", **_RO})
async def hearth_financial_summary(params: _NoArgs) -> str:
    """Get the top-level financial snapshot for the current month.

    This is the best first call for "how are my finances doing?" questions.

    Returns JSON:
        {
          "month": int, "year": int,
          "total_monthly_bills": float,   # sum of active bill amounts
          "paid_this_month": float, "paid_count": int,
          "unpaid_count": int, "remaining_this_month": float,
          "income_ytd": float,
          "cash": float, "investments": float, "retirement": float,
          "debt_total": float, "asset_total": float,
          "networth": float,              # cash+investments+retirement+assets-debt
          "bill_count": int
        }
    """
    return await _get("/analytics/summary")


@mcp.tool(name="hearth_net_worth_history", annotations={"title": "Net worth history", **_RO})
async def hearth_net_worth_history(params: _NoArgs) -> str:
    """Get the month-by-month net-worth snapshot history.

    Use for trend questions ("is my net worth growing?", projections). Each
    snapshot is frozen when the app is opened in that month.

    Returns JSON: a list of {year, month, net_worth, ...component balances}.
    """
    return await _get("/analytics/networth-history")


# --------------------------------------------------------------------------- #
# Bills, alerts, spending
# --------------------------------------------------------------------------- #

@mcp.tool(name="hearth_upcoming_bills", annotations={"title": "Upcoming & overdue bills", **_RO})
async def hearth_upcoming_bills(params: _NoArgs) -> str:
    """List upcoming and overdue bills with due dates and days-until.

    A paid bill whose due day has passed rolls forward to next month's date; an
    unpaid past-due bill is flagged 'overdue'. Status is one of
    'overdue' | 'due' (within 7 days) | 'sched'.

    Returns JSON: a list of bill items with name, amount, due_date, days_until,
    status, and whether it is paid.
    """
    return await _get("/analytics/upcoming")


@mcp.tool(name="hearth_alerts", annotations={"title": "Attention alerts", **_RO})
async def hearth_alerts(params: _NoArgs) -> str:
    """Get the aggregated 'needs attention' alert center.

    Combines overdue/due-soon bills, spending/usage anomalies, detected
    recurring charges, and a FICO-refresh nudge (score older than ~90 days or
    never recorded).

    Returns JSON: a list of alert objects with type, severity, and a message.
    """
    return await _get("/analytics/alerts")


@mcp.tool(name="hearth_spending", annotations={"title": "Spending by category", **_RO})
async def hearth_spending(params: _NoArgs) -> str:
    """Get spending broken down by category from imported bank transactions.

    Returns JSON: category totals derived from imported transactions.
    """
    return await _get("/analytics/spending")


@mcp.tool(name="hearth_category_budgets", annotations={"title": "Category budgets", **_RO})
async def hearth_category_budgets(params: _NoArgs) -> str:
    """Get this month's per-category spending budgets vs actual.

    Only categories that have a monthly budget set are returned (budgets are
    optional). Use this to answer "am I over budget on dining/groceries this
    month?" and similar.

    Returns JSON:
        {
          "year": int, "month": int,
          "budgets": [
            {
              "category": str,        # e.g. "Dining"
              "budget": float,        # monthly budget
              "actual": float,        # spent so far this month
              "remaining": float,     # budget - actual (negative = over)
              "pct": float | null,    # actual / budget * 100
              "over": bool            # actual > budget
            }
          ]  # sorted by pct descending (most over-budget first)
        }
    """
    return await _get("/analytics/category-budgets")


@mcp.tool(name="hearth_budget_vs_actual", annotations={"title": "Budget vs actual", **_RO})
async def hearth_budget_vs_actual(params: BudgetInput) -> str:
    """Compare budgeted targets against actual spending per category.

    Targets are derived from the user's budget allocation percentages applied to
    active take-home income; actuals come from bills paid, giving, investing
    contributions, planned debt payments, and imported outflows. Note that
    'save', 'debt', and 'live' actuals are honest approximations (the API
    returns caveats alongside the numbers).

    Args:
        params.period: 'month' (default) or 'ytd'.

    Returns JSON: per-category {target, actual, ...} plus caveats.
    """
    return await _get("/analytics/budget-actual", {"period": params.period})


# --------------------------------------------------------------------------- #
# Forecast, subscriptions, anomalies
# --------------------------------------------------------------------------- #

@mcp.tool(name="hearth_cashflow_forecast", annotations={"title": "Cash-flow forecast", **_RO})
async def hearth_cashflow_forecast(params: _NoArgs) -> str:
    """Project upcoming cash flow from bill due dates and estimated monthly income.

    Returns JSON: a forward projection of inflows/outflows / running balance.
    """
    return await _get("/analytics/forecast")


@mcp.tool(name="hearth_subscriptions", annotations={"title": "Recurring subscriptions", **_RO})
async def hearth_subscriptions(params: _NoArgs) -> str:
    """Detect recurring charges / subscriptions from imported transactions.

    Uses a merchant-key + cadence/coefficient-of-variation heuristic to find
    charges that repeat on a regular schedule.

    Returns JSON: a list of detected recurring charges with merchant, amount,
    and cadence.
    """
    return await _get("/analytics/subscriptions")


@mcp.tool(name="hearth_anomalies", annotations={"title": "Spending anomalies", **_RO})
async def hearth_anomalies(params: _NoArgs) -> str:
    """Find bills or utility usage that came in materially above their trend
    (more than ~25% over the trailing average).

    Returns JSON: a list of anomaly objects describing what spiked and by how much.
    """
    return await _get("/analytics/anomalies")


@mcp.tool(name="hearth_debt_payoff_plan", annotations={"title": "Debt payoff plan", **_RO})
async def hearth_debt_payoff_plan(params: DebtPayoffInput) -> str:
    """Simulate a debt-payoff plan (avalanche vs snowball roll-down).

    Args:
        params.extra: extra dollars per month on top of minimums (default 0).

    Returns JSON: payoff timelines and total interest for each strategy.
    """
    return await _get("/analytics/debt-payoff", {"extra": params.extra})


# --------------------------------------------------------------------------- #
# Raw records: bills, debts, income, accounts
# --------------------------------------------------------------------------- #

@mcp.tool(name="hearth_list_bills", annotations={"title": "List bills", **_RO})
async def hearth_list_bills(params: _NoArgs) -> str:
    """List all bills with their configured amount, due day, category, and autopay
    setting. Stored login credentials are NOT included (the read-only key cannot
    decrypt them).

    Returns JSON: a list of bill records.
    """
    return await _get("/bills")


@mcp.tool(name="hearth_list_debts", annotations={"title": "List debts", **_RO})
async def hearth_list_debts(params: _NoArgs) -> str:
    """List all debts with balance, interest rate, category, linked asset value,
    and monthly payment.

    Returns JSON: a list of debt records.
    """
    return await _get("/debt")


@mcp.tool(name="hearth_income_report", annotations={"title": "Income report", **_RO})
async def hearth_income_report(params: _NoArgs) -> str:
    """Get the income report summary: regular monthly income rate (counting only
    currently-active employment spans), annualized figures, and irregular
    income (bonuses, one-off deposits) for the current window.

    Returns JSON: income summary including regular_monthly_rate and YTD figures.
    """
    return await _get("/reports/summary")


@mcp.tool(name="hearth_list_income", annotations={"title": "List income sources", **_RO})
async def hearth_list_income(params: _NoArgs) -> str:
    """List recurring income sources (paychecks) with amount, frequency, type,
    employment start/end dates, and deduction breakdown.

    Returns JSON: a list of income records (active and ended).
    """
    return await _get("/income")


@mcp.tool(name="hearth_income_events", annotations={"title": "Income events", **_RO})
async def hearth_income_events(params: _NoArgs) -> str:
    """List one-off income events (bonuses, side-business payments, irregular
    deposits) with net and optional gross amounts and dates.

    Returns JSON: a list of income event records.
    """
    return await _get("/income/events")


@mcp.tool(name="hearth_cash_accounts", annotations={"title": "Cash accounts", **_RO})
async def hearth_cash_accounts(params: _NoArgs) -> str:
    """List cash / savings accounts and their balances and buckets.

    Returns JSON: a list of savings account records.
    """
    return await _get("/savings/accounts")


@mcp.tool(name="hearth_investments", annotations={"title": "Investment accounts", **_RO})
async def hearth_investments(params: _NoArgs) -> str:
    """List taxable investment accounts with balances and asset types.

    Returns JSON: a list of investment account records.
    """
    return await _get("/savings/investments")


@mcp.tool(name="hearth_retirement", annotations={"title": "Retirement accounts", **_RO})
async def hearth_retirement(params: _NoArgs) -> str:
    """List retirement (401k/IRA) accounts with balances and contribution percentages.

    Returns JSON: a list of retirement account records.
    """
    return await _get("/savings/retirement")


# --------------------------------------------------------------------------- #
# FICO, usage, business, transactions, giving
# --------------------------------------------------------------------------- #

@mcp.tool(name="hearth_fico_scores", annotations={"title": "FICO scores", **_RO})
async def hearth_fico_scores(params: _NoArgs) -> str:
    """List recorded FICO score history (manually entered) with dates.

    Returns JSON: a list of FICO score records, newest informative for the
    current standing.
    """
    return await _get("/fico")


@mcp.tool(name="hearth_usage_trends", annotations={"title": "Utility usage trends", **_RO})
async def hearth_usage_trends(params: _NoArgs) -> str:
    """Get utility usage trends (electric, gas, water, etc.) with per-period usage
    and cost.

    Returns JSON: per-utility series of readings (period, usage, unit, cost).
    """
    return await _get("/usage/trends")


@mcp.tool(name="hearth_usage_insights", annotations={"title": "Utility cost insights", **_RO})
async def hearth_usage_insights(params: _NoArgs) -> str:
    """Decompose the latest utility cost change into a usage effect vs a rate
    effect (how much of a bill change came from using more vs paying a higher
    rate), plus a year-over-year comparison.

    Returns JSON: per-utility breakdown of usage effect and rate effect.
    """
    return await _get("/usage/insights")


@mcp.tool(name="hearth_business_summary", annotations={"title": "Side-business summary", **_RO})
async def hearth_business_summary(params: _NoArgs) -> str:
    """Get the side-business summary: total billed, not-yet-invoiced, unpaid,
    hours worked, and active project count.

    Returns JSON: {billed, uninvoiced, unpaid, hours, active}.
    """
    return await _get("/business/summary")


@mcp.tool(name="hearth_business_projects", annotations={"title": "Side-business projects", **_RO})
async def hearth_business_projects(params: _NoArgs) -> str:
    """List side-business projects with per-project totals (hours, billed,
    uninvoiced, unpaid) and the configured hourly rate.

    Returns JSON: a list of project records with totals.
    """
    return await _get("/business/projects")


@mcp.tool(name="hearth_transactions", annotations={"title": "Imported transactions", **_RO})
async def hearth_transactions(params: _NoArgs) -> str:
    """List imported bank-statement transactions (merchant, amount, date,
    category). Useful for digging into specific spending.

    Returns JSON: a list of imported transaction records.
    """
    return await _get("/import/transactions")


@mcp.tool(name="hearth_giving", annotations={"title": "Charitable giving", **_RO})
async def hearth_giving(params: _NoArgs) -> str:
    """List charitable giving / donation events with amounts and dates.

    Returns JSON: a list of give-event records.
    """
    return await _get("/give")


# --------------------------------------------------------------------------- #
# Energy waste events (pushed in from the Home Automation app)
# --------------------------------------------------------------------------- #

class EnergyWasteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit: int = Field(default=200, description="Max number of events to return.", ge=1, le=5000)
    source: Optional[str] = Field(
        default=None,
        description="Filter by the app that pushed the events, e.g. 'home-automation'.",
    )


@mcp.tool(name="hearth_energy_waste", annotations={"title": "Energy waste events", **_RO})
async def hearth_energy_waste(params: EnergyWasteInput) -> str:
    """List energy 'waste events' pushed in from the Home Automation app — spans
    where a device drew power it arguably shouldn't have, with the wasted energy
    (kWh) and its estimated dollar cost. Newest first.

    Use these to reconcile avoidable energy spend against monthly utility bills.

    Args:
        params.limit: max events to return (default 200).
        params.source: optional source-app filter (e.g. 'home-automation').

    Returns JSON: a list of {id, source, device_id, start, end, kwh, cost, created_at}.
    """
    query: dict = {"limit": params.limit}
    if params.source:
        query["source"] = params.source
    return await _get("/energy/waste-events", query)


@mcp.tool(name="hearth_energy_waste_summary", annotations={"title": "Energy waste summary", **_RO})
async def hearth_energy_waste_summary(params: _NoArgs) -> str:
    """Summarize all energy waste events: total wasted kWh, total estimated cost,
    event count, and a per-month rollup. Best first call for "how much money am
    I wasting on energy?" questions.

    Returns JSON:
        {
          "event_count": int,
          "total_kwh": float,
          "total_cost": float,
          "by_month": [{"month": "YYYY-MM", "events": int, "kwh": float, "cost": float}]
        }
    """
    return await _get("/energy/summary")


if __name__ == "__main__":
    mcp.run()
