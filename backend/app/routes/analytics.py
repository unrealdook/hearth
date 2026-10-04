import re
import statistics
from datetime import date, timedelta
from collections import defaultdict
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from dateutil.relativedelta import relativedelta
from ..models import (db, Bill, PaymentRecord, Income, IncomeEvent, Debt, SavingsAccount,
                      InvestmentAccount, Retirement401k, ImportedTransaction,
                      UtilityReading, FicoEntry, NetWorthSnapshot, BudgetAllocation,
                      GiveEvent, InvestmentContribution, SpendingCategory, Paycheck)
from ..services import categorize as cat_svc
from ._helpers import require_auth

FREQ_PER_YEAR = {"monthly": 12, "biweekly": 26, "per_check": 26,
                 "semimonthly": 24, "weekly": 52, "annual": 1}


def _last_day_of_month(d: date) -> int:
    """Last calendar day of d's month."""
    nm = d.replace(day=1) + relativedelta(months=1)
    return (nm - timedelta(days=1)).day


def next_due_date(today: date, due_day: int | None) -> date:
    """
    Next occurrence of `due_day` on or after `today`.

    If today's day already passed the due day for this month, roll to next month.
    Clamps to the actual last day of the target month for short months
    (e.g. due_day=31 in April becomes April 30, in February becomes Feb 28/29).
    """
    day = max(1, min(31, due_day or 1))
    capped_this = min(day, _last_day_of_month(today))
    candidate = date(today.year, today.month, capped_this)
    if candidate >= today:
        return candidate
    nm = today.replace(day=1) + relativedelta(months=1)
    capped_next = min(day, _last_day_of_month(nm))
    return date(nm.year, nm.month, capped_next)

bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


def _compute_networth() -> dict:
    cash = float(db.session.query(func.coalesce(func.sum(SavingsAccount.balance), 0)).filter(SavingsAccount.is_business.isnot(True)).scalar() or 0)
    investments = float(db.session.query(func.coalesce(func.sum(InvestmentAccount.balance), 0)).scalar() or 0)
    retirement = float(db.session.query(func.coalesce(func.sum(Retirement401k.balance), 0)).scalar() or 0)
    debts = Debt.query.all()
    debt_total = sum(float(d.debt_amount or 0) for d in debts)
    asset_total = sum(float(d.asset_value or 0) for d in debts)
    return {
        "cash": cash, "investments": investments, "retirement": retirement,
        "asset_total": asset_total, "debt_total": debt_total,
        "total": cash + investments + retirement + asset_total - debt_total,
    }


def _ensure_snapshot():
    """Upsert the current month's net-worth snapshot. Called on dashboard load so
    each month gets a row (kept current as balances change during the month).
    Past months stay frozen — that's the trend."""
    today = date.today()
    nw = _compute_networth()
    snap = NetWorthSnapshot.query.filter_by(year=today.year, month=today.month).first()
    if snap is None:
        snap = NetWorthSnapshot(year=today.year, month=today.month)
        db.session.add(snap)
    snap.taken_on = today
    snap.cash = nw["cash"]
    snap.investments = nw["investments"]
    snap.retirement = nw["retirement"]
    snap.asset_value = nw["asset_total"]
    snap.debt = nw["debt_total"]
    snap.net_worth = nw["total"]
    db.session.commit()


@bp.get("/summary")
@require_auth
def summary():
    today = date.today()
    month, year = today.month, today.year
    try:
        _ensure_snapshot()  # keep this month's net-worth point fresh
    except Exception:
        db.session.rollback()

    bills = Bill.query.filter_by(is_active=True).all()
    total_monthly = sum(float(b.amount or 0) for b in bills)

    paid_this_month = (
        db.session.query(func.coalesce(func.sum(PaymentRecord.amount_paid), 0))
        .filter(PaymentRecord.paid == True, PaymentRecord.month == month, PaymentRecord.year == year).scalar()
    )
    paid_count = (
        db.session.query(func.count(PaymentRecord.id))
        .filter(PaymentRecord.paid == True, PaymentRecord.month == month, PaymentRecord.year == year).scalar()
    )
    # Compute "remaining" from the bills that don't yet have a payment record this
    # month, NOT from (total_bills - paid_amount). Otherwise variance between a
    # bill's configured amount and what you actually paid leaks into "remaining"
    # even when zero bills are outstanding.
    paid_bill_ids = {
        p.bill_id for p in PaymentRecord.query
        .filter_by(paid=True, month=month, year=year).all()
    }
    unpaid_bills = [b for b in bills if b.id not in paid_bill_ids]
    unpaid_count = len(unpaid_bills)
    remaining_this_month = sum(float(b.amount or 0) for b in unpaid_bills)

    income_year = (
        db.session.query(func.coalesce(func.sum(Income.amount), 0)).filter(Income.year == year).scalar()
    )

    cash = float(db.session.query(func.coalesce(func.sum(SavingsAccount.balance), 0)).filter(SavingsAccount.is_business.isnot(True)).scalar() or 0)
    investments = float(db.session.query(func.coalesce(func.sum(InvestmentAccount.balance), 0)).scalar() or 0)
    retirement = float(db.session.query(func.coalesce(func.sum(Retirement401k.balance), 0)).scalar() or 0)
    debt_total = float(db.session.query(func.coalesce(func.sum(Debt.debt_amount), 0)).scalar() or 0)
    asset_total = float(db.session.query(func.coalesce(func.sum(Debt.asset_value), 0)).scalar() or 0)

    networth = cash + investments + retirement + asset_total - debt_total

    return jsonify({
        "month": month, "year": year,
        "total_monthly_bills": float(total_monthly),
        "paid_this_month": float(paid_this_month or 0),
        "paid_count": int(paid_count or 0),
        "unpaid_count": int(unpaid_count),
        "remaining_this_month": float(remaining_this_month),
        "income_ytd": float(income_year or 0),
        "cash": cash,
        "investments": investments,
        "retirement": retirement,
        "debt_total": debt_total,
        "asset_total": asset_total,
        "networth": networth,
        "bill_count": len(bills),
    })


DUE_SOON_DAYS = 7  # within this many days counts as "due", else "sched"


def _paid_ids(month: int, year: int) -> set:
    return {p.bill_id for p in PaymentRecord.query
            .filter_by(paid=True, month=month, year=year).all()}


def _capped_day(due_day, d: date) -> int:
    return min(max(1, min(31, due_day or 1)), _last_day_of_month(d))


def bill_due_status(b, today: date, paid_this: bool, paid_next: bool):
    """The single source of truth for a bill's standing.

    Returns (due_date, days_until, status) or None when the bill is settled and
    nothing is coming up yet. Key rule: once this month's due day has passed,
    a *paid* bill rolls forward and shows its NEXT month occurrence as upcoming
    (so e.g. a bill due on the 1st, already paid for this month, still surfaces a
    few days before next month's). An *unpaid* past-due bill is overdue.
    """
    if not b.due_day:
        # No real due-day signal: show the nominal next date, never "overdue".
        due = next_due_date(today, b.due_day)
        days = (due - today).days
        return due, days, ("due" if days <= DUE_SOON_DAYS else "sched")

    this_cycle = date(today.year, today.month, _capped_day(b.due_day, today))

    if today <= this_cycle:
        # This month's bill is still ahead.
        if paid_this:
            return None  # already paid and not due yet → nothing to show
        days = (this_cycle - today).days
        return this_cycle, days, ("due" if days <= DUE_SOON_DAYS else "sched")

    # This month's due day has already passed.
    if paid_this:
        nm = today.replace(day=1) + relativedelta(months=1)
        next_cycle = date(nm.year, nm.month, _capped_day(b.due_day, nm))
        if paid_next:
            return None  # next month already prepaid too
        days = (next_cycle - today).days
        return next_cycle, days, ("due" if days <= DUE_SOON_DAYS else "sched")

    # Past due and unpaid → genuinely overdue.
    return this_cycle, (this_cycle - today).days, "overdue"


@bp.get("/upcoming")
@require_auth
def upcoming():
    """Upcoming + overdue bills. See bill_due_status for the rules — notably,
    a paid bill whose due day has passed rolls forward to next month's date
    instead of disappearing."""
    today = date.today()
    nm = today.replace(day=1) + relativedelta(months=1)
    paid_cur = _paid_ids(today.month, today.year)
    paid_next = _paid_ids(nm.month, nm.year)

    items = []
    for b in Bill.query.filter_by(is_active=True).all():
        res = bill_due_status(b, today, b.id in paid_cur, b.id in paid_next)
        if res is None:
            continue
        due, days_until, status = res
        items.append({
            **b.to_dict(),
            "due_date_iso": due.isoformat(),
            "days_until_due": days_until,
            "status": status,
        })
    items.sort(key=lambda x: x["days_until_due"])
    return jsonify(items)


@bp.get("/mom")
@require_auth
def mom():
    """Month-over-month: per-bill totals for the trailing 12 months."""
    rows = (db.session.query(PaymentRecord.bill_id, PaymentRecord.year, PaymentRecord.month,
                             func.sum(PaymentRecord.amount_paid))
            .filter(PaymentRecord.paid == True)
            .group_by(PaymentRecord.bill_id, PaymentRecord.year, PaymentRecord.month).all())
    series: dict[int, dict[str, float]] = defaultdict(dict)
    for bill_id, y, m, total in rows:
        key = f"{y:04d}-{m:02d}"
        series[bill_id][key] = float(total or 0)
    bills = {b.id: b.to_dict() for b in Bill.query.all()}
    out = []
    for bill_id, points in series.items():
        out.append({"bill": bills.get(bill_id, {"id": bill_id, "name": "Unknown"}), "points": points})
    return jsonify(out)


@bp.get("/yoy")
@require_auth
def yoy():
    rows = (db.session.query(PaymentRecord.year, func.sum(PaymentRecord.amount_paid))
            .filter(PaymentRecord.paid == True).group_by(PaymentRecord.year).all())
    return jsonify([{"year": y, "total": float(t or 0)} for y, t in rows])


def _spend_window():
    """Parse ?start=&end= (YYYY-MM-DD) plus an optional ?months=N shortcut.
    Returns (start_date|None, end_date|None)."""
    def _d(s):
        try:
            return date.fromisoformat(s) if s else None
        except ValueError:
            return None
    start = _d(request.args.get("start"))
    end = _d(request.args.get("end"))
    months = request.args.get("months", type=int)
    if months and not start:
        today = date.today()
        start = (today.replace(day=1) - relativedelta(months=months - 1))
    return start, end


def _spend_filter(query):
    """Apply the outflow + date-window filter shared by spending endpoints."""
    start, end = _spend_window()
    query = query.filter(ImportedTransaction.amount < 0)
    if start:
        query = query.filter(ImportedTransaction.date >= start)
    if end:
        query = query.filter(ImportedTransaction.date <= end)
    return query


def _reimbursable_inflows(start, end) -> dict[str, float]:
    """Deposits that offset spending, keyed by the category whose spend they
    reduce. Two sources: deposits categorized directly into a reimbursable
    category (Work Expense), and deposits in an inflow-alias category that
    points at one via offset_category_id (Work Reimbursement → Work Expense).
    Either way the payback never reads as income."""
    cats = SpendingCategory.query.all()
    by_id = {c.id: c for c in cats}
    src_to_target: dict[str, str] = {}
    for c in cats:
        if c.reimbursable:
            src_to_target[c.name] = c.name
        if c.offset_category_id and c.offset_category_id in by_id:
            src_to_target[c.name] = by_id[c.offset_category_id].name
    if not src_to_target:
        return {}
    q = (db.session.query(ImportedTransaction.category, func.sum(ImportedTransaction.amount))
         .filter(ImportedTransaction.amount > 0,
                 ImportedTransaction.category.in_(list(src_to_target))))
    if start:
        q = q.filter(ImportedTransaction.date >= start)
    if end:
        q = q.filter(ImportedTransaction.date <= end)
    out: dict[str, float] = {}
    for cname, total in q.group_by(ImportedTransaction.category).all():
        target = src_to_target[cname]
        out[target] = out.get(target, 0.0) + float(total or 0)
    return out


@bp.get("/spending")
@require_auth
def spending():
    """Spending by category for the selected window. Accepts ?start=&end= or
    ?months=N. Returns category, total, and the category's configured color.
    Reimbursable categories are netted against their inflows (clamped at 0 for
    the chart — a net-positive month isn't negative spend)."""
    rows = (_spend_filter(db.session.query(ImportedTransaction.category,
                                           func.sum(ImportedTransaction.amount)))
            .group_by(ImportedTransaction.category).all())
    inflows = _reimbursable_inflows(*_spend_window())
    colors = {c.name: c.color for c in SpendingCategory.query.all()}
    out = [{"category": c or "Uncategorized",
            "total": max(0.0, round(abs(float(t or 0)) - inflows.get(c, 0.0), 2)),
            "color": colors.get(c)} for c, t in rows]
    out.sort(key=lambda r: r["total"], reverse=True)
    return jsonify(out)


@bp.get("/category-budgets")
@require_auth
def category_budgets():
    """Per-category monthly budget vs actual for a given month (default current).
    Only categories with a budget set are returned. ?year=&month= to override."""
    today = date.today()
    year = request.args.get("year", default=today.year, type=int)
    month = request.args.get("month", default=today.month, type=int)
    first = date(year, month, 1)
    last = date(year, month, _last_day_of_month(first))

    # ?all=1 → every live category (for the Expenses tab), including ones with
    # no budget yet; default → only budgeted ones (Analytics behavior).
    if request.args.get("all", type=int):
        budgeted = (SpendingCategory.query
                    .filter(SpendingCategory.archived == False,   # noqa: E712
                            SpendingCategory.chart_hidden == False)  # noqa: E712
                    .order_by(SpendingCategory.sort_order.asc())
                    .all())
    else:
        budgeted = (SpendingCategory.query
                    .filter(SpendingCategory.monthly_budget.isnot(None))
                    .all())
    if not budgeted:
        return jsonify({"year": year, "month": month, "budgets": []})

    # Grouped outflow spend for the month; reimbursable categories net out
    # their inflows (paybacks) so `actual` is true out-of-pocket.
    rows = (db.session.query(ImportedTransaction.category, func.sum(ImportedTransaction.amount))
            .filter(ImportedTransaction.amount < 0,
                    ImportedTransaction.date >= first, ImportedTransaction.date <= last)
            .group_by(ImportedTransaction.category).all())
    spend = {c: abs(float(t or 0)) for c, t in rows}
    inflows = _reimbursable_inflows(first, last)

    out = []
    for c in budgeted:
        has_budget = c.monthly_budget is not None
        budget = float(c.monthly_budget or 0)
        actual = round(spend.get(c.name, 0.0) - inflows.get(c.name, 0.0), 2)
        out.append({
            "id": c.id,
            "category": c.name,
            "color": c.color,
            "reimbursable": bool(c.reimbursable),
            "budget": round(budget, 2) if has_budget else None,
            "actual": actual,
            "remaining": round(budget - actual, 2) if has_budget else None,
            "pct": round(max(actual, 0) / budget * 100, 1) if budget else None,
            "over": has_budget and actual > budget,
        })
    out.sort(key=lambda r: (r["pct"] if r["pct"] is not None else 0), reverse=True)
    return jsonify({"year": year, "month": month, "budgets": out})


@bp.get("/spending-merchants")
@require_auth
def spending_merchants():
    """Top merchants by spend for the selected window (same filters as /spending).
    Groups raw descriptions into a cleaned merchant name. ?limit= caps results."""
    limit = request.args.get("limit", default=15, type=int)
    rows = _spend_filter(db.session.query(
        ImportedTransaction.description, ImportedTransaction.amount,
        ImportedTransaction.category)).all()
    agg: dict = {}
    for desc, amount, category in rows:
        key = cat_svc.merchant_key(desc)
        a = agg.setdefault(key, {"merchant": key, "total": 0.0, "count": 0, "category": category})
        a["total"] += abs(float(amount or 0))
        a["count"] += 1
    items = sorted(agg.values(), key=lambda r: r["total"], reverse=True)
    for r in items:
        r["total"] = round(r["total"], 2)
    return jsonify(items[:limit] if limit else items)


def _monthly_rate(inc) -> float:
    """An income's pay rate normalized to dollars per month."""
    amt = float(inc.amount or 0)
    freq = (inc.frequency or "monthly").lower()
    if freq == "annual":
        return amt / 12.0
    if freq in ("per_check", "biweekly"):
        return amt * 26.0 / 12.0
    if freq == "weekly":
        return amt * 52.0 / 12.0
    if freq == "semimonthly":
        return amt * 2.0
    return amt


def _income_for_month(year: int, month: int) -> float:
    """Net income attributable to a month: recurring incomes active during that
    month (frequency-normalized to a monthly figure), plus any one-off income
    events that occurred in it. Recurring income lives as a rate + employment
    span, not per-month rows — so we derive the month's figure here.

    Each rate is pro-rated by the share of the month its employment span
    actually covers. Without that, a job change counts a full month of both the
    old and new salary — a month you never earned."""
    first = date(year, month, 1)
    days_in_month = _last_day_of_month(first)
    last = date(year, month, days_in_month)

    # Imported paychecks are ground truth. Any employer with a real check this
    # month uses its actual net; the rate estimate only fills in for employers
    # that don't have one, so the two never stack.
    checks = Paycheck.query.filter(Paycheck.check_date >= first,
                                   Paycheck.check_date <= last).all()
    total = sum(float(c.net or 0) for c in checks)
    covered = {c.income_id for c in checks if c.income_id}

    for inc in Income.query.all():
        if inc.id in covered:
            continue
        if inc.start_date and inc.start_date > last:
            continue
        if inc.end_date and inc.end_date < first:
            continue
        # Clip the employment span to this month; a span with no bounds covers
        # the whole month and pro-rates to 1.0.
        span_start = max(inc.start_date, first) if inc.start_date else first
        span_end = min(inc.end_date, last) if inc.end_date else last
        active_days = (span_end - span_start).days + 1
        if active_days <= 0:
            continue
        total += _monthly_rate(inc) * (active_days / days_in_month)

    # Events absorbed by a paycheck (a bonus paid on that check) are already
    # inside its net — counting them again would double the bonus.
    ev = (db.session.query(func.coalesce(func.sum(IncomeEvent.amount), 0))
          .filter(IncomeEvent.occurred_on >= first, IncomeEvent.occurred_on <= last,
                  IncomeEvent.paycheck_id.is_(None)).scalar())
    return round(total + float(ev or 0), 2)


def _outflow_for_month(year: int, month: int, hidden: list[str],
                       bills_map: dict[int, float]) -> tuple[float, str]:
    """Money that actually left, for one month.

    Real spending comes from imported transactions, minus categories the user
    hides from spending charts (Transfer above all — moving your own money
    between accounts isn't outflow) and minus reimbursements that pay a category
    back. Months with no imported activity yet fall back to paid bills, so the
    current month isn't an empty bar before you upload a statement.

    Returns (amount, source) so the client can say where the number came from."""
    first = date(year, month, 1)
    last = date(year, month, _last_day_of_month(first))

    imported = (db.session.query(ImportedTransaction.id)
                .filter(ImportedTransaction.date >= first,
                        ImportedTransaction.date <= last).first())
    if imported is None:
        return round(bills_map.get(month, 0.0), 2), "bills"

    q = (db.session.query(func.coalesce(func.sum(-ImportedTransaction.amount), 0))
         .filter(ImportedTransaction.amount < 0,
                 ImportedTransaction.date >= first,
                 ImportedTransaction.date <= last))
    if hidden:
        # NOT IN drops NULLs in SQL, so spell out the null/blank case.
        q = q.filter(db.or_(ImportedTransaction.category.is_(None),
                            ImportedTransaction.category == "",
                            ImportedTransaction.category.notin_(hidden)))
    spend = float(q.scalar() or 0)
    # A reimbursement isn't income — it cancels the spend it paid for.
    spend -= sum(_reimbursable_inflows(first, last).values())
    return round(max(spend, 0.0), 2), "transactions"


@bp.get("/cashflow")
@require_auth
def cashflow():
    """Monthly income vs outflow for the current year. Income is the recurring
    monthly rate (pro-rated over the span active that month) plus one-off income
    events; outflow is real spending, falling back to paid bills for months that
    haven't been imported yet."""
    today = date.today()
    out_rows = (db.session.query(PaymentRecord.month, func.sum(PaymentRecord.amount_paid))
                .filter(PaymentRecord.year == today.year, PaymentRecord.paid == True)
                .group_by(PaymentRecord.month).all())
    bills_map = {m: float(t or 0) for m, t in out_rows}
    hidden = [c.name for c in SpendingCategory.query.filter_by(chart_hidden=True).all()]
    result = []
    for m in range(1, today.month + 1):
        income = _income_for_month(today.year, m)
        outflow, source = _outflow_for_month(today.year, m, hidden, bills_map)
        if income or outflow:
            result.append({"month": m, "income": income, "outflow": outflow,
                           "outflow_source": source})
    return jsonify(result)


# ---------------------------------------------------------------------------
# Bill estimate drift — what a bill says vs what it actually costs
# ---------------------------------------------------------------------------

DRIFT_MIN_MONTHS = 3      # below this, one odd month would swing the average
DRIFT_MIN_DOLLARS = 5.0   # ignore rounding-level noise
DRIFT_MIN_PCT = 0.05


@bp.get("/bill-drift")
@require_auth
def bill_drift():
    """Bills whose stored estimate no longer matches what you actually pay.

    The estimate drives the upcoming list, the forecast and the monthly total,
    so a stale one quietly skews all three. Suggestion is the median of recent
    payments — median, not mean, so a single catch-up payment doesn't drag it."""
    lookback = request.args.get("months", default=6, type=int)
    today = date.today()
    cutoff = today.replace(day=1) - relativedelta(months=lookback - 1)

    by_bill: dict[int, list[float]] = defaultdict(list)
    rows = (PaymentRecord.query.filter_by(paid=True)
            .order_by(PaymentRecord.year.asc(), PaymentRecord.month.asc()).all())
    for p in rows:
        try:
            when = date(p.year, p.month, 1)
        except ValueError:
            continue
        if when < cutoff:
            continue
        amt = float(p.amount_paid or 0)
        if amt > 0:
            by_bill[p.bill_id].append(amt)

    out = []
    for bill in Bill.query.filter_by(is_active=True).all():
        amounts = by_bill.get(bill.id, [])
        if len(amounts) < DRIFT_MIN_MONTHS:
            continue
        estimate = float(bill.amount or 0)
        suggested = round(statistics.median(amounts), 2)
        delta = round(suggested - estimate, 2)
        if abs(delta) < DRIFT_MIN_DOLLARS:
            continue
        if estimate > 0 and abs(delta) / estimate < DRIFT_MIN_PCT:
            continue
        out.append({
            "bill_id": bill.id,
            "name": bill.name,
            "category": bill.category,
            "estimate": round(estimate, 2),
            "suggested": suggested,
            "delta": delta,
            "months": len(amounts),
            "recent": [round(a, 2) for a in amounts[-6:]],
            "spread": round(max(amounts) - min(amounts), 2),
        })

    out.sort(key=lambda r: -abs(r["delta"]))
    return jsonify({
        "bills": out,
        "count": len(out),
        # What the monthly total is off by if every suggestion were accepted.
        "monthly_delta": round(sum(r["delta"] for r in out), 2),
        "lookback_months": lookback,
    })


# ---------------------------------------------------------------------------
# Savings runway — how long savings covers a negative month
# ---------------------------------------------------------------------------

@bp.get("/runway")
@require_auth
def runway():
    """Burn rate and how many months savings covers it.

    Only counts months that have actually closed and have imported spending —
    a half-imported current month looks like a surplus and would flatter the
    number. Personal cash only; a business account isn't a safety net."""
    lookback = request.args.get("months", default=6, type=int)
    today = date.today()
    hidden = [c.name for c in SpendingCategory.query.filter_by(chart_hidden=True).all()]
    bills_rows = (db.session.query(PaymentRecord.month, func.sum(PaymentRecord.amount_paid))
                  .filter(PaymentRecord.year == today.year, PaymentRecord.paid == True)
                  .group_by(PaymentRecord.month).all())
    bills_map = {m: float(t or 0) for m, t in bills_rows}

    months = []
    cursor = today.replace(day=1) - relativedelta(months=lookback)
    while cursor < today.replace(day=1):
        income = _income_for_month(cursor.year, cursor.month)
        outflow, source = _outflow_for_month(cursor.year, cursor.month, hidden, bills_map)
        if source == "transactions":
            months.append({"year": cursor.year, "month": cursor.month,
                           "income": income, "outflow": outflow,
                           "net": round(income - outflow, 2)})
        cursor += relativedelta(months=1)

    cash = sum(float(a.balance or 0) for a in SavingsAccount.query.all() if not a.is_business)
    if not months:
        return jsonify({"months": [], "cash": round(cash, 2), "avg_net": None,
                        "runway_months": None, "negative_months": 0,
                        "basis": "no_closed_months"})

    avg_net = round(sum(m["net"] for m in months) / len(months), 2)
    negatives = [m for m in months if m["net"] < 0]
    runway_months = None
    if avg_net < 0:
        runway_months = round(cash / abs(avg_net), 1)

    return jsonify({
        "months": months,
        "cash": round(cash, 2),
        "avg_net": avg_net,
        "burn": round(abs(avg_net), 2) if avg_net < 0 else 0.0,
        "runway_months": runway_months,
        "negative_months": len(negatives),
        "total_months": len(months),
        "worst": min(months, key=lambda m: m["net"]) if months else None,
        "basis": "closed_imported_months",
    })


@bp.get("/budget-actual")
@require_auth
def budget_actual():
    """Compare budget allocation %s to what actually happened this month / YTD.
    Honest about the soft spots: debt is the planned monthly payment (we don't log
    per-debt payments) and 'save' is whatever's left after everything else."""
    period = request.args.get("period", "month")
    today = date.today()
    if period == "ytd":
        start, end, months = date(today.year, 1, 1), today, today.month
    else:
        period = "month"
        start, end, months = date(today.year, today.month, 1), today, 1

    # base income = active monthly take-home x months
    monthly_net = 0.0
    paycheck_401k_monthly = 0.0
    for inc in Income.query.all():
        if inc.start_date and inc.start_date > end:
            continue
        if inc.end_date and inc.end_date < start:
            continue
        per_month = FREQ_PER_YEAR.get(inc.frequency, 12) / 12
        monthly_net += float(inc.amount or 0) * per_month
        paycheck_401k_monthly += float(inc.retirement_401k_amount or 0) * per_month
    base = monthly_net * months

    # budget percentages — strongest across configured sources
    budgets = BudgetAllocation.query.all()
    pct = {k: max((float(getattr(b, f"{k}_pct") or 0) for b in budgets), default=0)
           for k in ("live", "invest", "save", "debt", "give")}

    def _in_window(d):
        return d is not None and start <= d <= end

    give = sum(float(g.amount or 0) for g in GiveEvent.query.all() if _in_window(g.occurred_on))
    invest = sum(float(c.amount or 0) for c in InvestmentContribution.query.all() if _in_window(c.occurred_on))
    invest += paycheck_401k_monthly * months
    debt_planned = sum(float(d.monthly_payment or 0) for d in Debt.query.all()) * months

    bills_paid = 0.0
    for p in PaymentRecord.query.filter_by(paid=True).all():
        try:
            mid = date(p.year, p.month, 15)
        except ValueError:
            continue
        if start <= mid <= end:
            bills_paid += float(p.amount_paid or 0)
    non_bill_spend = sum(-float(t.amount or 0) for t in ImportedTransaction.query.all()
                         if _in_window(t.date) and float(t.amount or 0) < 0 and not t.matched_bill_id)
    live = bills_paid + non_bill_spend

    save = base - (give + invest + debt_planned + live)

    actual = {"live": live, "invest": invest, "save": save, "debt": debt_planned, "give": give}
    labels = {"live": "Living", "invest": "Investing", "save": "Saving", "debt": "Debt paydown", "give": "Giving"}
    cats = []
    for k in ("live", "invest", "save", "debt", "give"):
        cats.append({
            "key": k, "label": labels[k],
            "pct": round(pct[k], 1),
            "target": round(base * pct[k] / 100, 2),
            "actual": round(actual[k], 2),
        })
    return jsonify({
        "period": period,
        "base_income": round(base, 2),
        "months": months,
        "categories": cats,
        "caveats": {
            "debt": "planned monthly payment (per-debt payments aren't logged)",
            "save": "whatever's left after living, investing, debt and giving",
            "live": "bills paid + imported spending not matched to a bill",
        },
    })


@bp.get("/networth")
@require_auth
def networth():
    return jsonify(_compute_networth())


@bp.get("/networth-history")
@require_auth
def networth_history():
    """Monthly net-worth snapshots (oldest first) for the trend chart."""
    try:
        _ensure_snapshot()
    except Exception:
        db.session.rollback()
    rows = (NetWorthSnapshot.query
            .order_by(NetWorthSnapshot.year.asc(), NetWorthSnapshot.month.asc()).all())
    return jsonify([r.to_dict() for r in rows])


@bp.get("/networth-projection")
@require_auth
def networth_projection():
    """Forward net-worth estimate driven by income, bills, and 401k contributions
    (the cash-flow forecast's signals) rather than extrapolating the recent
    snapshot slope. Returns the projected value and the monthly drivers behind it
    so the UI can explain the number."""
    try:
        months = max(1, min(120, int(request.args.get("months", 12))))
    except (TypeError, ValueError):
        months = 12

    nw = _compute_networth()
    cash = nw["cash"]
    retirement = nw["retirement"]
    investments = nw["investments"]
    assets = nw["asset_total"]
    debt = nw["debt_total"]
    start_total = cash + retirement + investments + assets - debt

    drivers = _monthly_networth_change()
    rates = _blended_growth_rates()
    monthly_contrib = drivers["monthly_retirement_contrib"]  # 401k, lands in retirement
    ret_monthly = rates["retirement_growth_pct"] / 100.0 / 12.0
    inv_monthly = rates["investment_growth_pct"] / 100.0 / 12.0

    # Cash-savings assumption. This household roughly breaks even on cash month to
    # month — discretionary/non-bill spending offsets the income−bills surplus
    # (the snapshots even dipped) — so we hold cash flat rather than banking the
    # full surplus. Net-worth growth therefore comes from 401k contributions plus
    # retirement/investment compounding. The unapplied surplus is still reported
    # in `drivers.monthly_savings` for context. Assets/debt held flat.
    applied_savings = 0.0

    for _ in range(months):
        cash += applied_savings
        retirement = retirement * (1 + ret_monthly) + monthly_contrib
        investments = investments * (1 + inv_monthly)
    projected = cash + retirement + investments + assets - debt
    avg_monthly_change = (projected - start_total) / months if months else 0.0

    return jsonify({
        "current_net_worth": round(start_total, 2),
        "months": months,
        "monthly_change": round(avg_monthly_change, 2),
        "projected_net_worth": round(projected, 2),
        "savings_basis": "break_even",
        "applied_monthly_savings": round(applied_savings, 2),
        "drivers": {**drivers, **rates},
    })


# ---------------------------------------------------------------------------
# Subscription detector
# ---------------------------------------------------------------------------

_STRIP_TOKENS = re.compile(r"[0-9#*]+|\b(?:xx+\w*|purchase|payment|recurring|autopay|pos|ach|web|id|ref|inv)\b")
ANOMALY_THRESHOLD = 0.25  # 25% above trailing average


def _merchant_key(description: str) -> str:
    """Collapse a transaction description to a stable merchant key so the same
    vendor groups together across statements (strips trailing ids/dates/noise)."""
    s = (description or "").lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = _STRIP_TOKENS.sub(" ", s)
    tokens = [t for t in s.split() if len(t) > 1]
    return " ".join(tokens[:3]).strip()


def _detect_subscriptions(min_count=2):
    """Find recurring outflows in imported transactions. Heuristic: same merchant
    seen multiple times at a regular cadence with stable amounts."""
    txs = (ImportedTransaction.query
           .filter(ImportedTransaction.amount < 0)
           .order_by(ImportedTransaction.date.asc()).all())
    groups: dict[str, list] = defaultdict(list)
    for t in txs:
        key = _merchant_key(t.description)
        if key:
            groups[key].append(t)

    today = date.today()
    out = []
    for key, items in groups.items():
        if len(items) < min_count:
            continue
        amounts = [abs(float(t.amount or 0)) for t in items]
        dates = [t.date for t in items if t.date]
        if len(dates) < min_count:
            continue
        gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        gaps = [g for g in gaps if g > 0]
        if not gaps:
            continue
        med_gap = statistics.median(gaps)
        med_amt = statistics.median(amounts)
        if med_amt <= 0 or med_gap <= 0:
            continue
        # regularity checks: gaps and amounts shouldn't be wild
        gap_cv = (statistics.pstdev(gaps) / med_gap) if len(gaps) > 1 else 0
        amt_cv = (statistics.pstdev(amounts) / med_amt) if len(amounts) > 1 else 0
        if gap_cv > 0.5 or amt_cv > 0.35:
            continue

        if med_gap <= 9:
            cadence = "weekly"
        elif med_gap <= 16:
            cadence = "biweekly"
        elif med_gap <= 45:
            cadence = "monthly"
        elif med_gap <= 100:
            cadence = "quarterly"
        elif med_gap <= 200:
            cadence = "semiannual"
        else:
            cadence = "yearly"

        last_seen = max(dates)
        monthly_cost = med_amt * (30.0 / med_gap)
        # "active" if we'd expect another charge soon given the cadence
        active = (today - last_seen).days <= med_gap * 1.6
        cats = [t.category for t in items if t.category]
        out.append({
            "merchant": items[-1].description or key,
            "key": key,
            "amount": round(med_amt, 2),
            "monthly_cost": round(monthly_cost, 2),
            "cadence": cadence,
            "count": len(items),
            "last_seen": last_seen.isoformat(),
            "active": active,
            # How steady the charge is — a true subscription bills the same
            # amount every time, which is what separates Netflix from Kroger.
            "amount_cv": round(amt_cv, 3),
            "category": statistics.mode(cats) if cats else None,
            "day_of_month": statistics.mode([d.day for d in dates]),
        })
    out.sort(key=lambda x: -x["monthly_cost"])
    return out


def _bill_signatures():
    """Precompute name signatures for every bill so detected recurring charges
    can be tagged when they line up with a bill you already track."""
    sigs = []
    for b in Bill.query.all():
        norm = re.sub(r"[^a-z0-9]", "", (b.name or "").lower())
        tokens = {t for t in _merchant_key(b.name or "").split() if len(t) >= 3}
        sigs.append({"id": b.id, "name": b.name, "norm": norm, "tokens": tokens})
    return sigs


def _match_bill(sub, sigs):
    """Heuristically match a detected recurring charge to a known bill. Bank
    descriptions are messy ('ATT*BILL PAYMENT 800-...' vs a bill named 'AT&T'),
    so we match on cleaned-token overlap, an exact bill-name token, or a
    despaced-substring of length >= 4. Returns the bill sig or None."""
    sub_tokens = {t for t in (sub.get("key") or "").split() if len(t) >= 3}
    sub_norm = re.sub(r"[^a-z0-9]", "", (sub.get("merchant") or "").lower())
    for s in sigs:
        if not s["norm"]:
            continue
        if s["tokens"] & sub_tokens:                       # shared distinctive token
            return s
        if s["norm"] in sub_tokens:                        # whole bill name is a token (e.g. 'att')
            return s
        if len(s["norm"]) >= 4 and s["norm"] in sub_norm:  # despaced substring
            return s
    return None


@bp.get("/subscriptions")
@require_auth
def subscriptions():
    subs = _detect_subscriptions()
    sigs = _bill_signatures()
    for s in subs:
        match = _match_bill(s, sigs)
        s["is_bill"] = match is not None
        s["bill_id"] = match["id"] if match else None
        s["bill_name"] = match["name"] if match else None
    total_monthly = sum(s["monthly_cost"] for s in subs if s["active"])
    return jsonify({
        "subscriptions": subs,
        "active_count": sum(1 for s in subs if s["active"]),
        "bill_count": sum(1 for s in subs if s["is_bill"]),
        "total_monthly": round(total_monthly, 2),
        "total_annual": round(total_monthly * 12, 2),
    })


# Categories where a repeating charge is a habit, not a subscription. Groceries
# and coffee recur very regularly; turning them into "bills" would be noise.
NOT_SUBSCRIPTION_CATEGORIES = {
    "Groceries", "Dining", "Fuel", "Travel", "Transfer", "Income",
    "Work Reimbursement", "Auto",
}
SUB_STEADY_CV = 0.12      # a real subscription bills the same amount each time
SUB_MIN_COUNT = 3
SUB_CADENCES = {"monthly", "quarterly", "semiannual", "yearly"}


@bp.get("/untracked-subscriptions")
@require_auth
def untracked_subscriptions():
    """Recurring charges that look like subscriptions but have no bill.

    Much stricter than /subscriptions, because each row here is a suggestion to
    create something. A weekly Instacart run is regular but isn't a
    subscription, so we require a steady amount, a billing-like cadence, and a
    category where a subscription is plausible."""
    subs = _detect_subscriptions(min_count=SUB_MIN_COUNT)
    sigs = _bill_signatures()
    out = []
    for s in subs:
        if _match_bill(s, sigs) is not None:
            continue
        if not s["active"]:
            continue
        if s["cadence"] not in SUB_CADENCES:
            continue
        if s["amount_cv"] > SUB_STEADY_CV:
            continue
        if (s.get("category") or "") in NOT_SUBSCRIPTION_CATEGORIES:
            continue
        out.append({
            **s,
            # Pre-filled bill fields so accepting is one click.
            "suggested_bill": {
                "name": _pretty_merchant(s["merchant"]),
                "amount": s["amount"],
                "category": s.get("category") or "Subscriptions",
                "due_day": s["day_of_month"],
                "is_autopay": True,
                "kind": "other",
            },
        })
    out.sort(key=lambda s: -s["monthly_cost"])
    variable = _variable_recurring(sigs)
    return jsonify({
        "subscriptions": out,
        "count": len(out),
        "monthly_total": round(sum(s["monthly_cost"] for s in out), 2),
        "annual_total": round(sum(s["monthly_cost"] for s in out) * 12, 2),
        "variable": variable,
        "variable_monthly_total": round(sum(v["monthly_avg"] for v in variable), 2),
    })


VARIABLE_MIN_COUNT = 6
VARIABLE_MIN_DAYS = 60
VARIABLE_CATEGORIES = {"Subscriptions"}


def _variable_recurring(sigs):
    """Merchants that charge you constantly, but never the same amount.

    Apple is the archetype: dozens of App Store charges from cents to three
    figures under one descriptor. That's several subscriptions plus one-off
    purchases, so it can't honestly become a single bill with a single amount —
    but it is real recurring money, and dropping it for failing the
    steady-amount test would hide the biggest one."""
    txs = (ImportedTransaction.query
           .filter(ImportedTransaction.amount < 0)
           .order_by(ImportedTransaction.date.asc()).all())
    groups: dict[str, list] = defaultdict(list)
    for t in txs:
        key = _merchant_key(t.description)
        if key:
            groups[key].append(t)

    out = []
    for key, items in groups.items():
        if len(items) < VARIABLE_MIN_COUNT:
            continue
        dates = [t.date for t in items if t.date]
        if len(dates) < VARIABLE_MIN_COUNT:
            continue
        span_days = (max(dates) - min(dates)).days
        if span_days < VARIABLE_MIN_DAYS:
            continue
        amounts = [abs(float(t.amount or 0)) for t in items]
        med = statistics.median(amounts)
        if med <= 0:
            continue
        if statistics.pstdev(amounts) / med <= SUB_STEADY_CV:
            continue  # steady enough to be a real bill; handled above
        cats = [t.category for t in items if t.category]
        category = statistics.mode(cats) if cats else None
        # Allow-list, not deny-list. Frequent-but-variable covers most of where
        # anyone shops — Walmart, takeout, ATM withdrawals — and listing those
        # as "untracked subscriptions" would bury the two that actually are.
        if (category or "") not in VARIABLE_CATEGORIES:
            continue
        stub = {"key": key, "merchant": items[-1].description or key}
        if _match_bill(stub, sigs) is not None:
            continue
        total = sum(amounts)
        months = max(span_days / 30.0, 1.0)
        out.append({
            "merchant": _pretty_merchant(items[-1].description or key),
            "key": key,
            "count": len(items),
            "total": round(total, 2),
            "monthly_avg": round(total / months, 2),
            "smallest": round(min(amounts), 2),
            "largest": round(max(amounts), 2),
            "category": category,
            "last_seen": max(dates).isoformat(),
        })
    out.sort(key=lambda v: -v["monthly_avg"])
    return out[:10]


def _pretty_merchant(description: str) -> str:
    """A human bill name from a bank description ('APPLE.COM/BILL 866-712-7753
    CA' -> 'Apple.com')."""
    s = re.split(r"\s{2,}", (description or "").strip())[0]
    s = re.sub(r"\b\d[\d-]{5,}\b", " ", s)            # phone numbers / ids
    s = re.sub(r"\*+", " ", s)
    s = re.sub(r"\b[A-Z]{2}\b$", "", s.strip())        # trailing state code
    s = re.sub(r"\s+", " ", s).strip(" -*")
    words = []
    for w in s.split()[:4]:
        words.append(w if any(c.islower() for c in w) else w.title())
    return " ".join(words)[:60] or (description or "")[:60]


# ---------------------------------------------------------------------------
# Anomaly detection — bills + utility usage above trailing average
# ---------------------------------------------------------------------------

def _detect_anomalies():
    out = []

    # Bills: latest paid amount vs trailing average of prior payments
    bills = {b.id: b for b in Bill.query.all()}
    by_bill: dict[int, list] = defaultdict(list)
    for p in (PaymentRecord.query.filter_by(paid=True)
              .order_by(PaymentRecord.year.asc(), PaymentRecord.month.asc()).all()):
        by_bill[p.bill_id].append(p)
    for bill_id, pays in by_bill.items():
        if len(pays) < 3:
            continue
        latest = float(pays[-1].amount_paid or 0)
        prior = [float(p.amount_paid or 0) for p in pays[:-1]][-6:]
        avg = sum(prior) / len(prior) if prior else 0
        if avg > 0 and latest > avg * (1 + ANOMALY_THRESHOLD):
            b = bills.get(bill_id)
            out.append({
                "kind": "bill",
                "name": b.name if b else f"bill #{bill_id}",
                "latest": round(latest, 2),
                "average": round(avg, 2),
                "pct": round((latest - avg) / avg * 100, 1),
                "period": f"{pays[-1].year}-{pays[-1].month:02d}",
                "unit": "$",
            })

    # Utility usage: latest reading vs trailing average usage
    readings: dict[str, list] = defaultdict(list)
    for r in UtilityReading.query.order_by(UtilityReading.period_end.asc()).all():
        if r.usage is not None:
            readings[r.utility_type].append(r)
    for utype, rs in readings.items():
        if len(rs) < 3:
            continue
        latest = float(rs[-1].usage or 0)
        prior = [float(x.usage or 0) for x in rs[:-1]][-6:]
        avg = sum(prior) / len(prior) if prior else 0
        if avg > 0 and latest > avg * (1 + ANOMALY_THRESHOLD):
            out.append({
                "kind": "usage",
                "name": utype,
                "latest": round(latest, 2),
                "average": round(avg, 2),
                "pct": round((latest - avg) / avg * 100, 1),
                "period": rs[-1].period_end.isoformat() if rs[-1].period_end else None,
                "unit": rs[-1].unit or "",
            })

    out.sort(key=lambda x: -x["pct"])
    return out


@bp.get("/anomalies")
@require_auth
def anomalies():
    return jsonify(_detect_anomalies())


# ---------------------------------------------------------------------------
# Cash-flow forecast
# ---------------------------------------------------------------------------

def _to_monthly(amount: float, freq: str | None) -> float:
    """Normalize a per-paycheck/annual amount to a monthly figure."""
    freq = (freq or "monthly").lower()
    if freq == "annual":
        return amount / 12.0
    if freq in ("per_check", "biweekly"):
        return amount * 26.0 / 12.0
    if freq == "weekly":
        return amount * 52.0 / 12.0
    if freq == "semimonthly":
        return amount * 2.0
    return amount  # monthly


def _active_income():
    """Income sources active today — ended jobs and not-yet-started ones excluded."""
    today = date.today()
    out = []
    for inc in Income.query.all():
        if inc.end_date and inc.end_date < today:
            continue
        if inc.start_date and inc.start_date > today:
            continue
        out.append(inc)
    return out


def _monthly_income_estimate() -> float:
    """Rough monthly net income from the Income table, normalizing frequency.
    Only counts income active today so the forecast reflects current earnings."""
    return sum(_to_monthly(float(inc.amount or 0), inc.frequency) for inc in _active_income())


def _monthly_networth_change() -> dict:
    """Expected monthly change in net worth, from the same signals the cash-flow
    forecast trusts: take-home income minus recurring bills (your monthly
    savings), plus 401k contributions — which grow net worth without ever
    touching your checking balance. This is what makes the projection realistic
    instead of blindly extending the last snapshot's slope."""
    monthly_income = _monthly_income_estimate()
    monthly_bills = float(
        db.session.query(func.coalesce(func.sum(Bill.amount), 0))
        .filter(Bill.is_active == True).scalar() or 0  # noqa: E712
    )
    retirement_contrib = sum(
        _to_monthly(float(inc.retirement_401k_amount or 0), inc.frequency)
        for inc in _active_income()
    )
    savings = monthly_income - monthly_bills
    return {
        "monthly_income": round(monthly_income, 2),
        "monthly_bills": round(monthly_bills, 2),
        "monthly_savings": round(savings, 2),
        "monthly_retirement_contrib": round(retirement_contrib, 2),
        "monthly_change": round(savings + retirement_contrib, 2),
    }


# Assumed annual return by investment classification — used only when an account
# doesn't carry its own rate. Deliberately conservative; tweak as desired.
_ASSET_RETURN = {
    "stock": 7.0, "reit": 6.0, "managed": 5.0, "cash_eq": 1.0, "real_estate": 4.0,
}


def _blended_growth_rates() -> dict:
    """Balance-weighted expected annual return for retirement and investments,
    from each account's own classification (Retirement401k.projected_growth_pct,
    InvestmentAccount.asset_type). Lets the net-worth projection compound the
    invested portion instead of treating it as dead weight."""
    # Clamp any single account's assumption to a believable band so one stray
    # value (e.g. a 25% typo) can't balloon the whole projection.
    def _sane(pct: float) -> float:
        return max(0.0, min(12.0, pct))

    rets = Retirement401k.query.all()
    ret_bal = sum(float(r.balance or 0) for r in rets)
    ret_rate = (
        sum(float(r.balance or 0) * _sane(float(r.projected_growth_pct or 0)) for r in rets) / ret_bal
        if ret_bal > 0 else 7.0
    )
    invs = InvestmentAccount.query.all()
    inv_bal = sum(float(i.balance or 0) for i in invs)
    inv_rate = (
        sum(float(i.balance or 0) * _sane(_ASSET_RETURN.get((i.asset_type or "").lower(), 5.0)) for i in invs) / inv_bal
        if inv_bal > 0 else 0.0
    )
    total_bal = ret_bal + inv_bal
    blended = ((ret_rate * ret_bal + inv_rate * inv_bal) / total_bal) if total_bal > 0 else 0.0
    return {
        "retirement_growth_pct": round(ret_rate, 2),
        "investment_growth_pct": round(inv_rate, 2),
        "blended_growth_pct": round(blended, 2),
    }


@bp.get("/forecast")
@require_auth
def forecast():
    """Project the running cash balance forward from known bill due dates and an
    estimated monthly income. Surfaces the projected low point."""
    today = date.today()
    try:
        days = max(7, min(120, int(request.args.get("days", 45))))
    except ValueError:
        days = 45
    horizon = today + timedelta(days=days)

    start_balance = float(db.session.query(func.coalesce(func.sum(SavingsAccount.balance), 0)).filter(SavingsAccount.is_business.isnot(True)).scalar() or 0)
    monthly_income = _monthly_income_estimate()

    events: list[dict] = []

    # Bill outflows: each active bill's occurrences within the window (unpaid this month)
    paid_set = {
        p.bill_id for p in PaymentRecord.query
        .filter_by(paid=True, month=today.month, year=today.year).all()
    }
    for b in Bill.query.filter_by(is_active=True).all():
        amt = float(b.amount or 0)
        if amt <= 0:
            continue
        occ = next_due_date(today, b.due_day)
        first = True
        while occ <= horizon:
            # skip the current-month occurrence if already paid
            if not (first and occ.month == today.month and occ.year == today.year and b.id in paid_set):
                events.append({"date": occ, "label": b.name, "delta": -amt, "kind": "bill"})
            occ = occ.replace(day=1) + relativedelta(months=1)
            capped = min(max(1, min(31, b.due_day or 1)), _last_day_of_month(occ))
            occ = date(occ.year, occ.month, capped)
            first = False

    # Income inflows: monthly estimate landing on the 1st of each month in window
    if monthly_income > 0:
        cursor = (today.replace(day=1) + relativedelta(months=1)) if today.day != 1 else today
        while cursor <= horizon:
            events.append({"date": cursor, "label": "Estimated income", "delta": monthly_income, "kind": "income"})
            cursor = cursor.replace(day=1) + relativedelta(months=1)

    events.sort(key=lambda e: e["date"])

    # Walk the timeline day by day for a smooth series + low point
    balance = start_balance
    series = [{"date": today.isoformat(), "balance": round(balance, 2)}]
    low_balance = balance
    low_date = today.isoformat()
    by_day: dict[date, float] = defaultdict(float)
    for e in events:
        by_day[e["date"]] += e["delta"]
    d = today
    while d <= horizon:
        if d in by_day:
            balance += by_day[d]
            series.append({"date": d.isoformat(), "balance": round(balance, 2)})
            if balance < low_balance:
                low_balance = balance
                low_date = d.isoformat()
        d += timedelta(days=1)

    return jsonify({
        "days": days,
        "start_balance": round(start_balance, 2),
        "end_balance": round(balance, 2),
        "low_balance": round(low_balance, 2),
        "low_date": low_date,
        "monthly_income_estimate": round(monthly_income, 2),
        "series": series,
        "events": [
            {"date": e["date"].isoformat(), "label": e["label"], "delta": round(e["delta"], 2), "kind": e["kind"]}
            for e in events
        ],
    })


# ---------------------------------------------------------------------------
# Debt payoff planner — avalanche vs snowball
# ---------------------------------------------------------------------------

def _simulate_payoff(debts: list[dict], extra: float, order_key) -> dict:
    """Roll-down simulation. `debts` is a list of {name, balance, rate, payment}.
    Returns months, total interest, payoff date, and per-debt payoff months."""
    debts = [dict(d) for d in debts if d["balance"] > 0]
    if not debts:
        return {"months": 0, "total_interest": 0.0, "payoff_date": None, "schedule": []}

    base_payment = sum(d["payment"] for d in debts) + extra
    total_interest = 0.0
    months = 0
    payoff_month: dict[str, int] = {}
    MAX_MONTHS = 1200

    while any(d["balance"] > 0 for d in debts) and months < MAX_MONTHS:
        months += 1
        # accrue interest
        for d in debts:
            if d["balance"] > 0:
                interest = d["balance"] * (d["rate"] / 100.0) / 12.0
                d["balance"] += interest
                total_interest += interest
        # available pool this month
        pool = base_payment
        # pay minimums first (capped at balance)
        active = sorted([d for d in debts if d["balance"] > 0], key=order_key)
        for d in active:
            pay = min(d["payment"], d["balance"], pool)
            d["balance"] -= pay
            pool -= pay
        # throw the rest at the priority debt(s)
        for d in sorted([d for d in debts if d["balance"] > 0], key=order_key):
            if pool <= 0:
                break
            pay = min(pool, d["balance"])
            d["balance"] -= pay
            pool -= pay
        # record payoffs
        for d in debts:
            if d["balance"] <= 0.005 and d["name"] not in payoff_month:
                d["balance"] = 0
                payoff_month[d["name"]] = months

    payoff_date = (date.today().replace(day=1) + relativedelta(months=months)) if months else None
    schedule = [{"name": n, "months": m} for n, m in sorted(payoff_month.items(), key=lambda kv: kv[1])]
    return {
        "months": months,
        "total_interest": round(total_interest, 2),
        "payoff_date": payoff_date.isoformat() if payoff_date else None,
        "schedule": schedule,
    }


@bp.get("/debt-payoff")
@require_auth
def debt_payoff():
    try:
        extra = max(0.0, float(request.args.get("extra", 0)))
    except ValueError:
        extra = 0.0

    rows = Debt.query.all()
    debts = [{
        "name": d.name,
        "balance": float(d.debt_amount or 0),
        "rate": float(d.interest_rate or 0),
        "payment": float(d.monthly_payment or 0),
    } for d in rows if float(d.debt_amount or 0) > 0]

    # guard: if any debt has no/low payment that can't cover interest, the sim
    # could run to the cap — that's still useful signal (it'll hit MAX_MONTHS).
    avalanche = _simulate_payoff(debts, extra, order_key=lambda d: -d["rate"])
    snowball = _simulate_payoff(debts, extra, order_key=lambda d: d["balance"])

    total_balance = sum(d["balance"] for d in debts)
    total_min = sum(d["payment"] for d in debts)

    # Budget context: how much is realistically available as "extra" each month.
    # Bills already include loan minimums, so we don't subtract debt_pct here —
    # only the planned save/invest/give slices of take-home.
    monthly_income = _monthly_income_estimate()
    monthly_bills = float(
        db.session.query(func.coalesce(func.sum(Bill.amount), 0))
        .filter(Bill.is_active == True).scalar() or 0  # noqa: E712
    )
    alloc = BudgetAllocation.query.filter_by(source="default").first()
    save_pct = float(alloc.save_pct or 0) if alloc else 0.0
    invest_pct = float(alloc.invest_pct or 0) if alloc else 0.0
    give_pct = float(alloc.give_pct or 0) if alloc else 0.0
    planned_save = monthly_income * save_pct / 100.0
    planned_invest = monthly_income * invest_pct / 100.0
    planned_give = monthly_income * give_pct / 100.0
    # Planned variable spending (gas, food, etc.) from category budgets.
    planned_expenses = float(
        db.session.query(func.coalesce(func.sum(SpendingCategory.monthly_budget), 0))
        .filter(SpendingCategory.archived == False,      # noqa: E712
                SpendingCategory.chart_hidden == False)  # noqa: E712
        .scalar() or 0
    )
    after_bills = monthly_income - monthly_bills
    after_expenses = after_bills - planned_expenses
    available_extra = after_expenses - planned_save - planned_invest - planned_give

    return jsonify({
        "total_balance": round(total_balance, 2),
        "total_min_payment": round(total_min, 2),
        "extra": round(extra, 2),
        "avalanche": avalanche,
        "snowball": snowball,
        "interest_saved_vs_snowball": round(snowball["total_interest"] - avalanche["total_interest"], 2),
        "budget": {
            "monthly_income": round(monthly_income, 2),
            "monthly_bills": round(monthly_bills, 2),
            "after_bills": round(after_bills, 2),
            "planned_expenses": round(planned_expenses, 2),
            "after_expenses": round(after_expenses, 2),
            "planned_save": round(planned_save, 2),
            "planned_invest": round(planned_invest, 2),
            "planned_give": round(planned_give, 2),
            "available_extra": round(available_extra, 2),
        },
    })


# ---------------------------------------------------------------------------
# Alert center — aggregate everything that wants attention
# ---------------------------------------------------------------------------

FICO_REFRESH_DAYS = 90


@bp.get("/alerts")
@require_auth
def alerts():
    today = date.today()
    items = []

    # Overdue / due-very-soon bills — same rule as /upcoming (rolls paid past-due
    # bills forward instead of hiding them).
    nm = today.replace(day=1) + relativedelta(months=1)
    paid_cur = _paid_ids(today.month, today.year)
    paid_next = _paid_ids(nm.month, nm.year)
    overdue = 0
    due_soon = 0
    for b in Bill.query.filter_by(is_active=True).all():
        res = bill_due_status(b, today, b.id in paid_cur, b.id in paid_next)
        if res is None:
            continue
        _due, days, status = res
        if status == "overdue":
            overdue += 1
        elif days <= 3:
            due_soon += 1
    if overdue:
        items.append({
            "severity": "danger", "category": "bills",
            "title": f"{overdue} bill{'s' if overdue != 1 else ''} overdue",
            "detail": "Past their due day this month with no payment recorded.",
            "route": "/bills",
        })
    if due_soon:
        items.append({
            "severity": "warning", "category": "bills",
            "title": f"{due_soon} bill{'s' if due_soon != 1 else ''} due within 3 days",
            "detail": "Coming up soon.",
            "route": "/bills",
        })

    # Anomalies
    for a in _detect_anomalies()[:4]:
        unit = "" if a["unit"] == "$" else f" {a['unit']}"
        items.append({
            "severity": "warning", "category": "anomaly",
            "title": f"{a['name']} is {a['pct']:.0f}% above average",
            "detail": f"Latest {a['latest']:,}{unit} vs ~{a['average']:,}{unit} typical.",
            "route": "/usage" if a["kind"] == "usage" else "/bills",
        })

    # Untracked active subscriptions (not linked to a bill)
    subs = _detect_subscriptions()
    active_subs = [s for s in subs if s["active"]]
    if active_subs:
        top = active_subs[0]
        items.append({
            "severity": "info", "category": "subscriptions",
            "title": f"{len(active_subs)} recurring charge{'s' if len(active_subs) != 1 else ''} detected",
            "detail": f"~${sum(s['monthly_cost'] for s in active_subs):,.2f}/mo, biggest is {top['merchant'][:40]}.",
            "route": "/analytics",
        })

    # FICO refresh due
    latest_fico = FicoEntry.query.order_by(FicoEntry.recorded_on.desc()).first()
    if not latest_fico:
        items.append({
            "severity": "info", "category": "fico",
            "title": "No FICO score logged yet",
            "detail": "Add your latest score to start tracking it.",
            "route": "/fico",
        })
    elif (today - latest_fico.recorded_on).days >= FICO_REFRESH_DAYS:
        days = (today - latest_fico.recorded_on).days
        items.append({
            "severity": "info", "category": "fico",
            "title": "Time to refresh your FICO",
            "detail": f"Last logged {days} days ago. A quarterly check keeps the trend useful.",
            "route": "/fico",
        })

    severity_rank = {"danger": 0, "warning": 1, "info": 2}
    items.sort(key=lambda x: severity_rank.get(x["severity"], 9))
    return jsonify({"alerts": items, "count": len(items)})
