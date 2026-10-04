from flask import Blueprint, request, jsonify
from ..models import db, BudgetAllocation
from ._helpers import require_auth

bp = Blueprint("budget", __name__, url_prefix="/api/budget")


@bp.get("")
@require_auth
def list_allocations():
    rows = BudgetAllocation.query.order_by(BudgetAllocation.source).all()
    if not rows:
        # seed default
        d = BudgetAllocation(source="default", live_pct=70, invest_pct=10, save_pct=10, debt_pct=10)
        db.session.add(d); db.session.commit()
        rows = [d]
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def create_or_update():
    data = request.get_json(silent=True) or {}
    source = data.get("source") or "default"
    rec = BudgetAllocation.query.filter_by(source=source).first()
    if not rec:
        rec = BudgetAllocation(source=source)
        db.session.add(rec)
    for f in ("live_pct", "invest_pct", "save_pct", "debt_pct", "give_pct"):
        if f in data and data[f] is not None:
            setattr(rec, f, data[f])
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/<int:rec_id>")
@require_auth
def delete_allocation(rec_id):
    rec = db.session.get(BudgetAllocation, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    if rec.source == "default":
        return jsonify(error="cannot_delete_default"), 400
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)
