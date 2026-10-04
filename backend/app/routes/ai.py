"""Local LLM Q&A. Injects current financial state as system context."""
from datetime import date, timedelta
from calendar import monthrange
from collections import defaultdict
from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import func
from ..models import (db, Bill, PaymentRecord, Income, IncomeEvent, Debt, SavingsAccount,
                      InvestmentAccount, Retirement401k, AppSetting,
                      ImportedTransaction, UtilityReading, FicoEntry, NetWorthSnapshot,
                      GiveEvent)
from ..services import ollama_client
from ._helpers import require_auth

FREQ_PER_YEAR = {"monthly": 12, "biweekly": 26, "per_check": 26,
                 "semimonthly": 24, "weekly": 52, "annual": 1}

bp = Blueprint("ai", __name__, url_prefix="/api/ai")


def _active_model() -> str:
    """User-chosen model wins over the .env default."""
    setting = db.session.get(AppSetting, "ollama_model")
    if setting and setting.value:
        return setting.value
    return current_app.config["OLLAMA_MODEL"]


SYSTEM_PROMPT = (
    "You are Hearth, a calm and concise personal finance assistant. "
    "Talk to the user in second person. Use plain language, no jargon, no emoji. "
    "Sentence case. Always show currency with a dollar sign and two decimals. "
    "Be direct. Cite specific numbers from the user's data. "
    "The user's full financial snapshot — including bills, debts, savings, "
    "income, payment history, and recent imported bank transactions — is provided "
    "in the next system message. Always use that data to answer; never claim you "
    "lack access to the user's finances. If a specific detail isn't in the snapshot, "
    "say what's missing rather than refusing."
)


SNAPSHOT_TX_DAYS = 90        # how far back to summarize imported transactions
SNAPSHOT_TX_RECENT_LIMIT = 60  # how many recent transactions to list verbatim


def _snapshot() -> str:
    today = date.today()
    cutoff = today - timedelta(days=SNAPSHOT_TX_DAYS)

    bills = Bill.query.filter_by(is_active=True).all()
    monthly_total = sum(float(b.amount or 0) for b in bills)
    income_total = float(db.session.query(func.coalesce(func.sum(Income.amount), 0)).scalar() or 0)
    debts = Debt.query.all()
    cash = float(db.session.query(func.coalesce(func.sum(SavingsAccount.balance), 0)).filter(SavingsAccount.is_business.isnot(True)).scalar() or 0)
    inv = float(db.session.query(func.coalesce(func.sum(InvestmentAccount.balance), 0)).scalar() or 0)
    ret = float(db.session.query(func.coalesce(func.sum(Retirement401k.balance), 0)).scalar() or 0)

    # imported transactions — last 90 days
    txs = (ImportedTransaction.query
           .filter(ImportedTransaction.date >= cutoff)
           .order_by(ImportedTransaction.date.desc()).all())
    spend_by_category: dict[str, float] = defaultdict(float)
    inflows = 0.0
    outflows = 0.0
    for t in txs:
        amt = float(t.amount or 0)
        if amt < 0:
            outflows += -amt
            spend_by_category[(t.category or "uncategorized").lower()] += -amt
        else:
            inflows += amt

    # payment records for the current month
    payments_now = (PaymentRecord.query
                    .filter_by(month=today.month, year=today.year, paid=True).all())

    lines = [
        f"## Current state (as of {today.isoformat()})",
        f"- Active bills: {len(bills)}, monthly total: ${monthly_total:,.2f}",
        f"- Income on record (lifetime): ${income_total:,.2f}",
        f"- Cash/savings: ${cash:,.2f} | Investments: ${inv:,.2f} | Retirement: ${ret:,.2f}",
        f"- Debts: {len(debts)} (total balance: ${sum(float(d.debt_amount or 0) for d in debts):,.2f})",
        "",
        "## Bills (configured monthly)",
    ]
    for b in bills:
        bal = f", balance left ${float(b.balance_remaining):,.2f}" if b.balance_remaining is not None else ""
        lines.append(f"- {b.category} / {b.name}: ${float(b.amount or 0):,.2f}, due day {b.due_day or '-'}, autopay: {b.is_autopay}{bal}")

    lines += ["", "## Debts"]
    for d in debts:
        lines.append(f"- {d.name}: balance ${float(d.debt_amount or 0):,.2f}, asset ${float(d.asset_value or 0):,.2f}, rate {float(d.interest_rate or 0)}%, monthly payment ${float(d.monthly_payment or 0):,.2f}")

    lines += ["", f"## This month's payments ({today.year}-{today.month:02d})"]
    if not payments_now:
        lines.append("- No bills marked paid yet for the current month.")
    else:
        bill_lookup = {b.id: b for b in bills}
        for p in payments_now:
            b = bill_lookup.get(p.bill_id)
            name = b.name if b else f"bill #{p.bill_id}"
            lines.append(f"- {name}: ${float(p.amount_paid or 0):,.2f} paid")

    lines += ["", f"## Imported transaction summary (last {SNAPSHOT_TX_DAYS} days)"]
    if not txs:
        lines.append("- No imported transactions in this window.")
    else:
        lines.append(f"- {len(txs)} transactions: ${inflows:,.2f} in, ${outflows:,.2f} out")
        if spend_by_category:
            top = sorted(spend_by_category.items(), key=lambda kv: -kv[1])[:12]
            lines.append("- Spending by category:")
            for cat, amt in top:
                lines.append(f"  - {cat}: ${amt:,.2f}")

        recent = txs[:SNAPSHOT_TX_RECENT_LIMIT]
        lines += ["", f"## Most recent {len(recent)} transactions"]
        for t in recent:
            sign = "+" if (t.amount or 0) > 0 else "-"
            amt = abs(float(t.amount or 0))
            desc = (t.description or "")[:60]
            cat = t.category or "—"
            lines.append(f"- {t.date.isoformat()} {sign}${amt:,.2f} [{cat}] {desc}")

    return "\n".join(lines)


@bp.post("/chat")
@require_auth
def chat():
    body = request.get_json(silent=True) or {}
    question = (body.get("question") or "").strip()
    if not question:
        return jsonify(error="missing_question"), 400

    base_url = current_app.config["OLLAMA_URL"]
    model = _active_model()

    if not ollama_client.is_running(base_url):
        return jsonify(error="ollama_unreachable",
                       message=f"Could not reach Ollama at {base_url}. Is `ollama serve` running?"), 503

    snapshot = _snapshot()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": snapshot},
        {"role": "user", "content": question},
    ]
    # Optionally carry the current session's prior turns so follow-ups have
    # context, WITHOUT persisting anything. The client owns the transcript and
    # sends it back each turn; it lives only for the life of the open session.
    prior = body.get("history") or []
    for turn in prior[-12:]:  # cap context window — last 6 exchanges
        q = (turn.get("question") or "").strip()
        a = (turn.get("answer") or "").strip()
        if q:
            messages.insert(-1, {"role": "user", "content": q})
        if a:
            messages.insert(-1, {"role": "assistant", "content": a})

    try:
        answer = ollama_client.chat(base_url, model, messages)
    except ollama_client.OllamaError as e:
        return jsonify(error="ollama_error", message=str(e)), 502

    # Ephemeral by design: we do NOT persist conversations. The transcript
    # lives in the browser tab and is gone when the session ends.
    return jsonify({"question": question, "answer": answer})


@bp.get("/status")
@require_auth
def status():
    base_url = current_app.config["OLLAMA_URL"]
    reachable = ollama_client.is_running(base_url)
    available = ollama_client.list_models(base_url) if reachable else []
    model = _active_model()
    installed = any(m["name"] == model for m in available)
    return jsonify({
        "ollama_url": base_url,
        "model": model,
        "reachable": reachable,
        "model_installed": installed,
        "available_models": available,
    })


DIGEST_PROMPT = (
    "You are Hearth, a calm personal finance assistant writing a short monthly "
    "digest for the user. Use second person, plain language, sentence case, no "
    "emoji, no exclamation marks. Currency with a dollar sign and two decimals. "
    "Write 3-5 short paragraphs (or tight grouped lines) covering, where data "
    "exists: income, what went out (bills/spending), how net worth moved, "
    "utilities, FICO, and giving. Cite the actual numbers from the data provided "
    "in the next message — never invent figures. Be honest about what's notable, "
    "good or concerning. End with one gentle, specific suggestion for next month. "
    "Keep it under 200 words."
)


def _month_digest_context(year: int, month: int):
    last = monthrange(year, month)[1]
    start, end = date(year, month, 1), date(year, month, last)
    label = start.strftime("%B %Y")
    lines = [f"# Financial data for {label}"]

    # income — active recurring + one-off events in the month
    monthly_income = 0.0
    for inc in Income.query.all():
        if inc.start_date and inc.start_date > end:
            continue
        if inc.end_date and inc.end_date < start:
            continue
        per_year = FREQ_PER_YEAR.get(inc.frequency, 12)
        monthly_income += float(inc.amount or 0) * per_year / 12
    events = (IncomeEvent.query
              .filter(IncomeEvent.occurred_on >= start, IncomeEvent.occurred_on <= end).all())
    irregular = sum(float(e.amount or 0) for e in events)
    inc_line = f"- Income: about ${monthly_income:,.2f} regular take-home"
    if irregular:
        inc_line += f", plus ${irregular:,.2f} from {len(events)} one-off payment(s)"
    lines.append(inc_line)

    # bills paid
    paid = PaymentRecord.query.filter_by(paid=True, month=month, year=year).all()
    if paid:
        lines.append(f"- Bills paid: ${sum(float(p.amount_paid or 0) for p in paid):,.2f} across {len(paid)} payments")

    # spending by category from imported transactions
    txs = (ImportedTransaction.query
           .filter(ImportedTransaction.date >= start, ImportedTransaction.date <= end,
                   ImportedTransaction.amount < 0).all())
    if txs:
        bycat = defaultdict(float)
        for t in txs:
            bycat[(t.category or "uncategorized").lower()] += -float(t.amount or 0)
        top = sorted(bycat.items(), key=lambda kv: -kv[1])[:6]
        lines.append("- Spending by category: " + ", ".join(f"{c} ${v:,.0f}" for c, v in top))

    # net worth + change
    snap = NetWorthSnapshot.query.filter_by(year=year, month=month).first()
    pm_y, pm_m = (year, month - 1) if month > 1 else (year - 1, 12)
    prev = NetWorthSnapshot.query.filter_by(year=pm_y, month=pm_m).first()
    if snap:
        nw_line = f"- Net worth: ${float(snap.net_worth):,.2f}"
        if prev:
            d = float(snap.net_worth) - float(prev.net_worth)
            nw_line += f", {'up' if d >= 0 else 'down'} ${abs(d):,.2f} from the prior month"
        lines.append(nw_line)

    # utilities this month, with prior-month usage if available
    readings = (UtilityReading.query
                .filter(UtilityReading.period_end >= start, UtilityReading.period_end <= end).all())
    for r in readings:
        prior = (UtilityReading.query
                 .filter(UtilityReading.utility_type == r.utility_type,
                         UtilityReading.period_end < start)
                 .order_by(UtilityReading.period_end.desc()).first())
        u = f"{float(r.usage):,.0f} {r.unit or ''}" if r.usage is not None else "n/a"
        line = f"- {r.utility_type} usage: {u}, cost ${float(r.cost or 0):,.2f}"
        if prior and prior.usage and r.usage is not None and float(prior.usage) > 0:
            pct = (float(r.usage) - float(prior.usage)) / float(prior.usage) * 100
            line += f" ({pct:+.0f}% usage vs prior reading)"
        lines.append(line)

    # FICO
    ficos = FicoEntry.query.order_by(FicoEntry.recorded_on.desc()).limit(2).all()
    if ficos:
        fl = f"- FICO: {ficos[0].score}"
        if len(ficos) > 1:
            fl += f" ({ficos[0].score - ficos[1].score:+d} since the previous entry)"
        lines.append(fl)

    # giving
    gives = (GiveEvent.query
             .filter(GiveEvent.occurred_on >= start, GiveEvent.occurred_on <= end).all())
    if gives:
        lines.append(f"- Giving: ${sum(float(g.amount or 0) for g in gives):,.2f} across {len(gives)} gift(s)")

    return label, "\n".join(lines)


@bp.post("/digest")
@require_auth
def digest():
    body = request.get_json(silent=True) or {}
    today = date.today()
    try:
        month = int(body.get("month") or today.month)
        year = int(body.get("year") or today.year)
    except (TypeError, ValueError):
        return jsonify(error="bad_period"), 400

    base_url = current_app.config["OLLAMA_URL"]
    model = _active_model()
    if not ollama_client.is_running(base_url):
        return jsonify(error="ollama_unreachable",
                       message=f"Could not reach Ollama at {base_url}. Is `ollama serve` running?"), 503

    label, context = _month_digest_context(year, month)
    messages = [
        {"role": "system", "content": DIGEST_PROMPT},
        {"role": "system", "content": context},
        {"role": "user", "content": f"Write my financial digest for {label}."},
    ]
    try:
        answer = ollama_client.chat(base_url, model, messages)
    except ollama_client.OllamaError as e:
        return jsonify(error="ollama_error", message=str(e)), 502
    return jsonify(month=month, year=year, label=label, digest=answer)


@bp.post("/model")
@require_auth
def set_model():
    body = request.get_json(silent=True) or {}
    name = (body.get("model") or "").strip()
    if not name:
        return jsonify(error="missing_model"), 400
    setting = db.session.get(AppSetting, "ollama_model")
    if not setting:
        setting = AppSetting(key="ollama_model", value=name)
        db.session.add(setting)
    else:
        setting.value = name
    db.session.commit()
    return jsonify(ok=True, model=name)
