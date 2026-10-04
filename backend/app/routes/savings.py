"""
Savings + investments + 401k + owed-to-me.

A single namespace because the UI surfaces them together as "Net worth".
"""
from datetime import date, datetime
from flask import Blueprint, request, jsonify
from sqlalchemy import extract, or_
from ..models import db, SavingsAccount, InvestmentAccount, Retirement401k, OwedToMe, InvestmentContribution, AppSetting
from ._helpers import require_auth

bp = Blueprint("savings", __name__, url_prefix="/api/savings")

PAY_FROM_KEY = "pay_from_account_id"


# ---- pay-from designation (which account bills auto-deduct from) --------------------
@bp.get("/pay-from")
@require_auth
def get_pay_from():
    s = db.session.get(AppSetting, PAY_FROM_KEY)
    acct = None
    if s and s.value:
        try:
            acct = db.session.get(SavingsAccount, int(s.value))
        except (TypeError, ValueError):
            acct = None
    return jsonify({"account_id": acct.id if acct else None,
                    "account": acct.to_dict() if acct else None})


@bp.put("/pay-from")
@require_auth
def set_pay_from():
    data = request.get_json(silent=True) or {}
    val = data.get("account_id")
    value = str(int(val)) if val else None  # None clears (auto-deduct off)
    s = db.session.get(AppSetting, PAY_FROM_KEY)
    if s is None:
        s = AppSetting(key=PAY_FROM_KEY, value=value)
        db.session.add(s)
    else:
        s.value = value
    db.session.commit()
    return jsonify(ok=True, account_id=(int(val) if val else None))


def _parse_date(s, default=None):
    if not s:
        return default
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return default


# ---- savings (cash + named buckets) -------------------------------------------------
@bp.get("/accounts")
@require_auth
def list_accounts():
    # Manual order wins; name is only a tiebreak for rows that share a slot.
    rows = SavingsAccount.query.order_by(SavingsAccount.sort_order, SavingsAccount.name).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/accounts")
@require_auth
def create_account():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify(error="missing_name"), 400
    # New accounts land at the bottom instead of jumping the list alphabetically.
    last = db.session.query(db.func.max(SavingsAccount.sort_order)).scalar() or 0
    rec = SavingsAccount(name=data["name"], balance=data.get("balance", 0),
                        bucket=data.get("bucket", "cash"), notes=data.get("notes"),
                        is_business=bool(data.get("is_business", False)),
                        sort_order=last + 1)
    db.session.add(rec); db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/accounts/reorder")
@require_auth
def reorder_accounts():
    """Set the display order from a list of account ids, top to bottom. Ids that
    aren't sent keep their position after the ones that were."""
    data = request.get_json(silent=True) or {}
    ids = data.get("order")
    if not isinstance(ids, list):
        return jsonify(error="missing_order"), 400
    by_id = {a.id: a for a in SavingsAccount.query.all()}
    seen = set()
    slot = 0
    for raw in ids:
        try:
            acct = by_id.get(int(raw))
        except (TypeError, ValueError):
            continue
        if acct is None or acct.id in seen:
            continue
        slot += 1
        acct.sort_order = slot
        seen.add(acct.id)
    for acct in sorted((a for a in by_id.values() if a.id not in seen),
                       key=lambda a: (a.sort_order or 0, a.name or "")):
        slot += 1
        acct.sort_order = slot
    db.session.commit()
    rows = SavingsAccount.query.order_by(SavingsAccount.sort_order, SavingsAccount.name).all()
    return jsonify([r.to_dict() for r in rows])


@bp.put("/accounts/<int:rec_id>")
@require_auth
def update_account(rec_id):
    rec = db.session.get(SavingsAccount, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    for f in ("name", "balance", "bucket", "notes"):
        if f in data: setattr(rec, f, data[f])
    if "is_business" in data:
        rec.is_business = bool(data["is_business"])
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/accounts/<int:rec_id>")
@require_auth
def delete_account(rec_id):
    rec = db.session.get(SavingsAccount, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    db.session.delete(rec); db.session.commit()
    return jsonify(ok=True)


# ---- investments --------------------------------------------------------------------
@bp.get("/investments")
@require_auth
def list_investments():
    rows = InvestmentAccount.query.order_by(InvestmentAccount.asset_type, InvestmentAccount.name).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/investments")
@require_auth
def create_investment():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify(error="missing_name"), 400
    rec = InvestmentAccount(name=data["name"])
    for f in ("asset_type", "symbol", "balance", "notes"):
        if f in data and data[f] is not None:
            setattr(rec, f, data[f])
    db.session.add(rec); db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/investments/<int:rec_id>")
@require_auth
def update_investment(rec_id):
    rec = db.session.get(InvestmentAccount, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    for f in ("name", "asset_type", "symbol", "balance", "notes"):
        if f in data: setattr(rec, f, data[f])
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/investments/<int:rec_id>")
@require_auth
def delete_investment(rec_id):
    rec = db.session.get(InvestmentAccount, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    db.session.delete(rec); db.session.commit()
    return jsonify(ok=True)


# ---- 401k ---------------------------------------------------------------------------
@bp.get("/retirement")
@require_auth
def list_retirement():
    rows = Retirement401k.query.order_by(Retirement401k.name).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/retirement")
@require_auth
def create_retirement():
    data = request.get_json(silent=True) or {}
    rec = Retirement401k(name=data.get("name", "401k"))
    for f in ("balance", "contribution_pct", "employer_match_pct", "projected_growth_pct"):
        if f in data and data[f] is not None:
            setattr(rec, f, data[f])
    db.session.add(rec); db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/retirement/<int:rec_id>")
@require_auth
def update_retirement(rec_id):
    rec = db.session.get(Retirement401k, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    for f in ("name", "balance", "contribution_pct", "employer_match_pct", "projected_growth_pct"):
        if f in data: setattr(rec, f, data[f])
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/retirement/<int:rec_id>")
@require_auth
def delete_retirement(rec_id):
    rec = db.session.get(Retirement401k, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    db.session.delete(rec); db.session.commit()
    return jsonify(ok=True)


# ---- investment contributions -------------------------------------------------------
# A contribution is a deposit into either a 401k account or an investment account
# (Roth IRA, Traditional IRA, brokerage, etc.). The single table tracks both via
# `account_kind` and the matching FK column.

@bp.get("/contributions")
@require_auth
def list_contributions():
    """All contributions across all accounts, optionally filtered by year."""
    year = request.args.get("year", type=int)
    q = InvestmentContribution.query
    if year:
        q = q.filter(extract("year", InvestmentContribution.occurred_on) == year)
    rows = q.order_by(InvestmentContribution.occurred_on.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/contributions")
@require_auth
def create_contribution():
    data = request.get_json(silent=True) or {}
    kind = (data.get("account_kind") or "").strip()
    if kind not in ("retirement_401k", "investment"):
        return jsonify(error="invalid_account_kind"), 400
    account_id = data.get("account_id")
    if not account_id:
        return jsonify(error="missing_account_id"), 400
    # verify the referenced account exists
    if kind == "retirement_401k":
        if not db.session.get(Retirement401k, account_id):
            return jsonify(error="account_not_found"), 404
    else:
        if not db.session.get(InvestmentAccount, account_id):
            return jsonify(error="account_not_found"), 404
    occurred = _parse_date(data.get("occurred_on"), default=date.today())
    try:
        amount = float(data.get("amount") or 0)
    except (TypeError, ValueError):
        return jsonify(error="invalid_amount"), 400
    rec = InvestmentContribution(
        account_kind=kind,
        retirement_id=account_id if kind == "retirement_401k" else None,
        investment_id=account_id if kind == "investment" else None,
        occurred_on=occurred,
        amount=amount,
        note=(data.get("note") or None),
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.delete("/contributions/<int:rec_id>")
@require_auth
def delete_contribution(rec_id):
    rec = db.session.get(InvestmentContribution, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)


# ---- owed to me ---------------------------------------------------------------------
@bp.get("/owed")
@require_auth
def list_owed():
    rows = OwedToMe.query.order_by(OwedToMe.created_at.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/owed")
@require_auth
def create_owed():
    data = request.get_json(silent=True) or {}
    if not data.get("person"):
        return jsonify(error="missing_person"), 400
    rec = OwedToMe(person=data["person"], amount=data.get("amount", 0), notes=data.get("notes"))
    db.session.add(rec); db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/owed/<int:rec_id>")
@require_auth
def update_owed(rec_id):
    rec = db.session.get(OwedToMe, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    for f in ("person", "amount", "notes"):
        if f in data: setattr(rec, f, data[f])
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/owed/<int:rec_id>")
@require_auth
def delete_owed(rec_id):
    rec = db.session.get(OwedToMe, rec_id)
    if not rec: return jsonify(error="not_found"), 404
    db.session.delete(rec); db.session.commit()
    return jsonify(ok=True)
