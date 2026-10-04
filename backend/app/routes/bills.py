from datetime import date, datetime

from flask import Blueprint, request, jsonify
from ..models import db, Bill, Debt
from ..services import encryption
from ._helpers import require_auth, get_session_key

bp = Blueprint("bills", __name__, url_prefix="/api/bills")


def _parse_date(raw):
    if not raw:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _num(raw):
    if raw in (None, ""):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _matching_debt(bill: Bill):
    """The Debt row that tracks the same obligation as this bill.

    Bills and debts are separate tables with no key between them, so this
    matches on a normalized name. Used only to *offer* clearing the debt — never
    to clear it silently, because a wrong match would wipe a real balance.
    """
    norm = lambda v: "".join(ch for ch in (v or "").lower() if ch.isalnum())
    target = norm(bill.name)
    if not target:
        return None
    for d in Debt.query.all():
        if norm(d.name) == target and float(d.debt_amount or 0) > 0:
            return d
    return None


def _apply(bill: Bill, data: dict, key: str | None):
    for f in ("category", "name", "notes", "payment_url", "kind", "usage_unit"):
        if f in data:
            setattr(bill, f, data[f] or None if f == "usage_unit" else data[f])
    for f in ("amount", "credit_limit", "balance_remaining"):
        if f in data and data[f] is not None:
            setattr(bill, f, data[f])
        elif f in data and data[f] is None:
            setattr(bill, f, None)
    for f in ("due_day", "term_months"):
        if f in data and data[f] is not None:
            setattr(bill, f, int(data[f]))
    for f in ("is_autopay", "is_active"):
        if f in data:
            setattr(bill, f, bool(data[f]))
    if "paid_off_on" in data:
        bill.paid_off_on = _parse_date(data["paid_off_on"])
    # A card you paid off and then charged again isn't paid off any more. Leaving
    # the badge up would be a standing untruth about money, so a new balance
    # clears it — but only for a bill still in rotation; a closed-out loan stays
    # archived until it's explicitly reopened.
    elif (bill.paid_off_on and bill.is_active
          and _num(data.get("balance_remaining")) not in (None, 0)):
        bill.paid_off_on = None
    # credentials, only if a key is provided in the session
    if key:
        if "username" in data:
            bill.username_enc = encryption.encrypt(data["username"], key)
        if "password" in data:
            bill.password_enc = encryption.encrypt(data["password"], key)


@bp.get("")
@require_auth
def list_bills():
    only_active = request.args.get("active")
    q = Bill.query
    if only_active == "true":
        q = q.filter_by(is_active=True)
    bills = q.order_by(Bill.category, Bill.name).all()
    return jsonify([b.to_dict() for b in bills])


@bp.post("")
@require_auth
def create_bill():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify(error="missing_name"), 400
    bill = Bill(name=data["name"])
    _apply(bill, data, get_session_key())
    db.session.add(bill)
    db.session.commit()
    return jsonify(bill.to_dict()), 201


@bp.get("/<int:bill_id>")
@require_auth
def get_bill(bill_id):
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    return jsonify(bill.to_dict())


@bp.put("/<int:bill_id>")
@require_auth
def update_bill(bill_id):
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    _apply(bill, data, get_session_key())
    db.session.commit()
    return jsonify(bill.to_dict())


@bp.delete("/<int:bill_id>")
@require_auth
def delete_bill(bill_id):
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    db.session.delete(bill)
    db.session.commit()
    return jsonify(ok=True)


@bp.get("/<int:bill_id>/payoff-preview")
@require_auth
def payoff_preview(bill_id):
    """What marking this bill paid off would also touch."""
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    debt = _matching_debt(bill)
    return jsonify({
        "bill": bill.to_dict(),
        "matching_debt": ({"id": debt.id, "name": debt.name,
                           "debt_amount": float(debt.debt_amount or 0),
                           "monthly_payment": float(debt.monthly_payment or 0)}
                          if debt else None),
    })


@bp.post("/<int:bill_id>/paid-off")
@require_auth
def mark_paid_off(bill_id):
    """Mark a bill paid off, either closing it out or leaving it in rotation.

    Body: {close: bool, on?: "YYYY-MM-DD", clear_debt?: bool}

    `close` is the whole point of the two options. A finished loan should stop
    being billed forever; a credit card you just zeroed is still a live account
    you'll use next month, so it stays in the payment list.
    """
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    close = bool(data.get("close", True))

    bill.paid_off_on = _parse_date(data.get("on")) or date.today()
    bill.balance_remaining = 0
    if close:
        # Closing is what keeps it out of upcoming bills, the monthly total and
        # the forecast — every one of those already filters on is_active.
        bill.is_active = False

    cleared_debt = None
    if data.get("clear_debt"):
        debt = _matching_debt(bill)
        if debt is not None:
            cleared_debt = {"id": debt.id, "name": debt.name,
                            "was": float(debt.debt_amount or 0)}
            # Zero rather than delete: the row keeps its history, and both the
            # payoff plan and net worth already ignore a zero balance. The
            # monthly payment has to go too or the forecast keeps spending it.
            debt.debt_amount = 0
            debt.monthly_payment = 0

    db.session.commit()
    return jsonify({**bill.to_dict(), "cleared_debt": cleared_debt})


@bp.delete("/<int:bill_id>/paid-off")
@require_auth
def unmark_paid_off(bill_id):
    """Undo a payoff. Reactivates the bill; the balance stays whatever it is."""
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    bill.paid_off_on = None
    bill.is_active = True
    db.session.commit()
    return jsonify(bill.to_dict())
