from calendar import monthrange
from datetime import datetime, date
from flask import Blueprint, request, jsonify
from ..models import db, PaymentRecord, Bill, SavingsAccount, AppSetting, UtilityReading
from ..services.usage_parse import UTILITY_TYPES
from ._helpers import require_auth

bp = Blueprint("payments", __name__, url_prefix="/api/payments")

PAY_FROM_KEY = "pay_from_account_id"


def _log_usage(bill, rec, usage_raw):
    """When a usage value comes in with a payment, upsert that month's utility
    reading (usage + the amount paid as cost) so paying the bill also feeds the
    Usage trend. Keyed by (utility_type, period_end) like the bulk importer."""
    if usage_raw is None or usage_raw == "":
        return None
    try:
        usage = float(usage_raw)
    except (TypeError, ValueError):
        return None
    utype = bill.kind if (bill.kind in UTILITY_TYPES) else "other"
    last = monthrange(rec.year, rec.month)[1]
    period_end = date(rec.year, rec.month, last)
    reading = UtilityReading.query.filter_by(utility_type=utype, period_end=period_end).first()
    if reading is None:
        reading = UtilityReading(utility_type=utype, period_start=date(rec.year, rec.month, 1),
                                 period_end=period_end)
        db.session.add(reading)
    reading.usage = usage
    reading.unit = bill.usage_unit or reading.unit
    reading.cost = float(rec.amount_paid or 0)
    reading.bill_id = bill.id
    return {"utility_type": utype, "usage": usage, "unit": bill.usage_unit, "period_end": period_end.isoformat()}


def _pay_from_account():
    """The account bills are auto-deducted from, or None if the feature is off."""
    s = db.session.get(AppSetting, PAY_FROM_KEY)
    if not s or not s.value:
        return None
    try:
        return db.session.get(SavingsAccount, int(s.value))
    except (TypeError, ValueError):
        return None


def _sync_account(rec, bill=None):
    """Reconcile the pay-from account against this record. Applies only the net
    change between what it has already deducted and what it should now deduct
    (amount_paid when paid, else 0). Idempotent across repeated saves. Returns a
    summary dict (for the client) or None when auto-deduct is off.

    Records that don't deduct (auto-pay bills, or an explicit per-month opt-out)
    target 0, which also refunds anything a previous save had taken out."""
    acct = _pay_from_account()
    if acct is None:
        return None
    deducts = rec.deducts(bill)
    target = float(rec.amount_paid or 0) if (rec.paid and deducts) else 0.0
    prev = float(rec.deducted_amount or 0)
    delta = round(target - prev, 2)
    if delta != 0:
        acct.balance = round(float(acct.balance or 0) - delta, 2)
    rec.deducted_amount = target
    return {
        "account_id": acct.id,
        "account_name": acct.name,
        "deducted": delta,
        "new_balance": float(acct.balance or 0),
        "skipped": not deducts,
    }


def _read_skip(data, rec):
    """Apply an incoming skip_deduction value. None clears the override so the
    record falls back to the bill's auto-pay setting."""
    if "skip_deduction" not in data:
        return
    raw = data["skip_deduction"]
    rec.skip_deduction = None if raw is None else bool(raw)


@bp.get("")
@require_auth
def list_payments():
    month = request.args.get("month", type=int)
    year = request.args.get("year", type=int)
    bill_id = request.args.get("bill_id", type=int)
    q = PaymentRecord.query
    if month: q = q.filter_by(month=month)
    if year:  q = q.filter_by(year=year)
    if bill_id: q = q.filter_by(bill_id=bill_id)
    rows = q.order_by(PaymentRecord.year.desc(), PaymentRecord.month.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def create_payment():
    data = request.get_json(silent=True) or {}
    bill_id = data.get("bill_id")
    if not bill_id:
        return jsonify(error="missing_bill_id"), 400
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="bill_not_found"), 404
    now = datetime.utcnow()
    month = data.get("month") or now.month
    year = data.get("year") or now.year
    rec = PaymentRecord.query.filter_by(bill_id=bill_id, month=month, year=year).first()
    if not rec:
        rec = PaymentRecord(bill_id=bill_id, month=month, year=year)
        db.session.add(rec)
    if "amount_paid" in data and data["amount_paid"] is not None:
        rec.amount_paid = data["amount_paid"]
    elif rec.amount_paid in (None, 0):
        rec.amount_paid = float(bill.amount or 0)
    if "paid" in data:
        rec.paid = bool(data["paid"])
        rec.paid_date = datetime.utcnow() if rec.paid else None
    if "notes" in data:
        rec.notes = data["notes"]
    _read_skip(data, rec)
    pay_from = _sync_account(rec, bill)
    # Remember the unit on the bill so it prefills next time.
    if data.get("usage_unit"):
        bill.usage_unit = str(data["usage_unit"]).strip() or bill.usage_unit
    usage_logged = _log_usage(bill, rec, data.get("usage")) if "usage" in data else None
    db.session.commit()
    return jsonify({**rec.to_dict(bill), "pay_from": pay_from, "usage_logged": usage_logged}), 201


@bp.put("/<int:rec_id>")
@require_auth
def update_payment(rec_id):
    rec = db.session.get(PaymentRecord, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "amount_paid" in data and data["amount_paid"] is not None:
        rec.amount_paid = data["amount_paid"]
    if "paid" in data:
        rec.paid = bool(data["paid"])
        rec.paid_date = datetime.utcnow() if rec.paid else None
    if "notes" in data:
        rec.notes = data["notes"]
    _read_skip(data, rec)
    pay_from = _sync_account(rec)
    db.session.commit()
    return jsonify({**rec.to_dict(), "pay_from": pay_from})


@bp.delete("/<int:rec_id>")
@require_auth
def delete_payment(rec_id):
    rec = db.session.get(PaymentRecord, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    # Refund whatever this record had deducted before removing it.
    acct = _pay_from_account()
    if acct is not None and rec.deducted_amount:
        acct.balance = round(float(acct.balance or 0) + float(rec.deducted_amount or 0), 2)
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)
