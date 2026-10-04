from flask import Blueprint, request, jsonify
from ..models import db, Debt
from ._helpers import require_auth

bp = Blueprint("debt", __name__, url_prefix="/api/debt")


@bp.get("")
@require_auth
def list_debts():
    rows = Debt.query.order_by(Debt.category, Debt.name).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def create_debt():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify(error="missing_name"), 400
    rec = Debt(name=data["name"])
    for f in ("debt_amount", "asset_value", "interest_rate", "monthly_payment", "category", "group_name", "notes"):
        if f in data and data[f] is not None:
            setattr(rec, f, data[f])
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/<int:rec_id>")
@require_auth
def update_debt(rec_id):
    rec = db.session.get(Debt, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    for f in ("name", "debt_amount", "asset_value", "interest_rate", "monthly_payment", "category", "group_name", "notes"):
        if f in data:
            setattr(rec, f, data[f])
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/<int:rec_id>")
@require_auth
def delete_debt(rec_id):
    rec = db.session.get(Debt, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)
