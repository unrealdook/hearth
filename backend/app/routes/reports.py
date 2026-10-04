"""Cross-domain report aggregations.

The Reports page is for periodic (monthly / quarterly / annual) family review.
This route flattens everything we know about a date range into one JSON blob
the frontend can render as a card grid.

Caveat: we don't snapshot balances over time, so debt/savings/investment-account
balances are reported as *current* values, not delta-over-period. Flows we *do*
have (irregular income events, investment contributions, bill payments, give
events) are summed over the requested window.
"""
from datetime import date, datetime, timedelta
from collections import defaultdict
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from ..models import (
    db, Income, IncomeEvent, Bill, PaymentRecord, Debt, SavingsAccount,
    InvestmentAccount, Retirement401k, InvestmentContribution, GiveEvent,
)
from ._helpers import require_auth

bp = Blueprint("reports", __name__, url_prefix="/api/reports")


FREQ_PER_YEAR = {
    "monthly": 12, "biweekly": 26, "per_check": 26, "semimonthly": 24,
    "weekly": 52, "annual": 1,
}


def _parse_date(s, default=None):
    if not s:
        return default
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return default


def _months_between(start: date, end: date) -> float:
    """Approximate number of months in [start, end] inclusive — fractional ok."""
    if end < start:
        return 0.0
    days = (end - start).days + 1
    return days / 30.4375


def _default_window():
    """Default range — current calendar year up through today."""
    today = date.today()
    return date(today.year, 1, 1), today


@bp.get("/summary")
@require_auth
def summary():
    start = _parse_date(request.args.get("from"))
    end = _parse_date(request.args.get("to"))
    if not start or not end:
        start, end = _default_window()
    if end < start:
        start, end = end, start

    months = _months_between(start, end)

    # ---- income -----------------------------------------------------------
    # `amount` on Income is NET / take-home per check. If `gross_amount` is set,
    # we have a full paycheck breakdown — sum the gross + each deduction line
    # across the period so Reports can show gross vs. net and tax flow.
    incomes = Income.query.all()
    # Current monthly *rate* — only income still active as of the window end.
    # Drives regular_monthly_rate (and the dashboard's annual-goal math), so a
    # job you've left stops counting toward "what you currently earn".
    income_net_monthly = 0.0
    income_gross_monthly = 0.0
    # Period *totals* — each income counted only for the months it was active
    # within [start, end]. A job ended mid-window stops contributing; a job that
    # started mid-window only counts from its start. Historical rows still exist
    # for lifetime queries — they just don't bleed past their employment span.
    income_regular = 0.0
    income_gross = 0.0
    fed_tax_total = 0.0
    state_tax_total = 0.0
    fica_total = 0.0
    paycheck_401k_total = 0.0
    employer_match_total = 0.0
    health_total = 0.0
    other_ded_total = 0.0
    for i in incomes:
        per_year = FREQ_PER_YEAR.get(i.frequency, 12)
        per_month = per_year / 12
        net = float(i.amount or 0)
        gross = float(i.gross_amount) if i.gross_amount is not None else net

        # Active overlap of this income's employment span with the report window.
        span_start = i.start_date or start
        span_end = i.end_date or end
        active_start = max(start, span_start)
        active_end = min(end, span_end)
        active_months = _months_between(active_start, active_end) if active_end >= active_start else 0.0

        income_regular += net * per_month * active_months
        income_gross += gross * per_month * active_months
        fed_tax_total += float(i.federal_tax or 0) * per_month * active_months
        state_tax_total += float(i.state_tax or 0) * per_month * active_months
        fica_total += float(i.fica or 0) * per_month * active_months
        paycheck_401k_total += float(i.retirement_401k_amount or 0) * per_month * active_months
        health_total += float(i.health_insurance or 0) * per_month * active_months
        other_ded_total += float(i.other_deductions or 0) * per_month * active_months
        # Employer 401(k) match: percentage of gross set on the linked Retirement401k.
        # Match isn't a paycheck deduction (it's separate employer money), so it
        # only adds to invested-flow, not to deductions/net.
        if i.paycheck_retirement_account_id and i.gross_amount:
            ret = db.session.get(Retirement401k, i.paycheck_retirement_account_id)
            if ret and ret.employer_match_pct:
                match_pct = float(ret.employer_match_pct or 0)
                employer_match_total += gross * (match_pct / 100.0) * per_month * active_months

        # Still active at the window end? Then it sets the current monthly rate.
        active_at_end = ((i.start_date is None or i.start_date <= end)
                         and (i.end_date is None or i.end_date >= end))
        if active_at_end:
            income_net_monthly += net * per_month
            income_gross_monthly += gross * per_month

    income_regular_monthly = income_net_monthly  # kept for backward compat

    irregular_q = (IncomeEvent.query
                   .filter(IncomeEvent.occurred_on >= start)
                   .filter(IncomeEvent.occurred_on <= end)
                   .all())
    income_irregular = sum(float(e.amount or 0) for e in irregular_q)
    income_irregular_by_kind = defaultdict(float)
    for e in irregular_q:
        income_irregular_by_kind[e.kind] += float(e.amount or 0)

    # ---- bills paid -------------------------------------------------------
    # PaymentRecord has (month, year) granularity, not a full date — so include
    # any record whose (year, month) midpoint falls in window.
    paid_q = (PaymentRecord.query
              .filter(PaymentRecord.paid.is_(True))
              .all())
    bills_paid = 0.0
    for p in paid_q:
        try:
            midpoint = date(p.year, p.month, 15)
        except ValueError:
            continue
        if start <= midpoint <= end:
            bills_paid += float(p.amount_paid or 0)

    # ---- debt (current snapshot only) ------------------------------------
    debts = Debt.query.all()
    debt_total = sum(float(d.debt_amount or 0) for d in debts)
    debt_assets = sum(float(d.asset_value or 0) for d in debts)

    # ---- savings + investments (current snapshot only) -------------------
    savings_total = sum(float(s.balance or 0) for s in SavingsAccount.query.all() if not s.is_business)
    investments_total = sum(float(i.balance or 0) for i in InvestmentAccount.query.all())
    retirement_total = sum(float(r.balance or 0) for r in Retirement401k.query.all())

    # ---- investment contributions (flow in window) -----------------------
    contribs = (InvestmentContribution.query
                .filter(InvestmentContribution.occurred_on >= start)
                .filter(InvestmentContribution.occurred_on <= end)
                .all())
    contrib_total = sum(float(c.amount or 0) for c in contribs)
    contrib_by_kind = defaultdict(float)
    for c in contribs:
        # break out 401k vs investment account, and further by asset_type if available
        if c.account_kind == "retirement_401k":
            contrib_by_kind["401k"] += float(c.amount or 0)
        else:
            acct = db.session.get(InvestmentAccount, c.investment_id) if c.investment_id else None
            label = (acct.asset_type if acct else "investment")
            contrib_by_kind[label] += float(c.amount or 0)

    # Inferred 401(k) from paycheck breakdowns over the window — already
    # computed as paycheck_401k_total above. Add to the by-kind breakdown
    # under a separate "401k (paycheck)" label so it doesn't double-count
    # with manually-logged InvestmentContribution rows.
    if paycheck_401k_total > 0:
        contrib_by_kind["401k_paycheck"] += paycheck_401k_total
    if employer_match_total > 0:
        contrib_by_kind["401k_employer_match"] += employer_match_total
    contrib_total_incl_paycheck = contrib_total + paycheck_401k_total + employer_match_total

    # ---- giving (flow in window) -----------------------------------------
    gives = (GiveEvent.query
             .filter(GiveEvent.occurred_on >= start)
             .filter(GiveEvent.occurred_on <= end)
             .all())
    give_total = sum(float(g.amount or 0) for g in gives)
    give_by_category = defaultdict(float)
    for g in gives:
        give_by_category[g.category or "other"] += float(g.amount or 0)

    # ---- net worth snapshot ----------------------------------------------
    net_worth = savings_total + investments_total + retirement_total + debt_assets - debt_total

    has_breakdown = income_gross_monthly > income_net_monthly + 0.01
    return jsonify({
        "period": {
            "from": start.isoformat(),
            "to": end.isoformat(),
            "months": round(months, 2),
        },
        "income": {
            "regular_projected": round(income_regular, 2),
            "regular_monthly_rate": round(income_regular_monthly, 2),
            "gross_projected": round(income_gross, 2),
            "gross_monthly_rate": round(income_gross_monthly, 2),
            "has_breakdown": has_breakdown,
            "deductions": {
                "federal_tax": round(fed_tax_total, 2),
                "state_tax": round(state_tax_total, 2),
                "fica": round(fica_total, 2),
                "retirement_401k": round(paycheck_401k_total, 2),
                "health_insurance": round(health_total, 2),
                "other": round(other_ded_total, 2),
            },
            "irregular_total": round(income_irregular, 2),
            "irregular_by_kind": {k: round(v, 2) for k, v in income_irregular_by_kind.items()},
            "total": round(income_regular + income_irregular, 2),
        },
        "bills": {
            "paid_in_period": round(bills_paid, 2),
            "paid_count": sum(
                1 for p in paid_q
                if _safe_in_window(p, start, end)
            ),
        },
        "investments": {
            "contributed_in_period": round(contrib_total_incl_paycheck, 2),
            "contributed_logged": round(contrib_total, 2),
            "contributed_via_paycheck": round(paycheck_401k_total, 2),
            "contributed_employer_match": round(employer_match_total, 2),
            "by_kind": {k: round(v, 2) for k, v in contrib_by_kind.items()},
            "balance_now": round(investments_total + retirement_total, 2),
            "balance_investment_accounts": round(investments_total, 2),
            "balance_retirement": round(retirement_total, 2),
        },
        "give": {
            "total_in_period": round(give_total, 2),
            "by_category": {k: round(v, 2) for k, v in give_by_category.items()},
            "event_count": len(gives),
        },
        "snapshot": {
            "savings": round(savings_total, 2),
            "investments": round(investments_total, 2),
            "retirement": round(retirement_total, 2),
            "debt": round(debt_total, 2),
            "debt_backed_assets": round(debt_assets, 2),
            "net_worth": round(net_worth, 2),
        },
    })


def _safe_in_window(p: PaymentRecord, start: date, end: date) -> bool:
    try:
        midpoint = date(p.year, p.month, 15)
    except ValueError:
        return False
    return start <= midpoint <= end
