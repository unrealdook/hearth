from datetime import date as date_cls
from flask import Blueprint, request, jsonify
from ..models import db, FicoEntry
from ._helpers import require_auth

bp = Blueprint("fico", __name__, url_prefix="/api/fico")


@bp.get("")
@require_auth
def list_entries():
    rows = FicoEntry.query.order_by(FicoEntry.recorded_on.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def create_entry():
    data = request.get_json(silent=True) or {}
    if not data.get("score") or not data.get("recorded_on"):
        return jsonify(error="missing_fields", message="score and recorded_on are required"), 400
    try:
        recorded = date_cls.fromisoformat(data["recorded_on"])
    except ValueError:
        return jsonify(error="bad_date"), 400
    rec = FicoEntry(
        score=int(data["score"]),
        model_name=data.get("model_name", "FICO Score 8"),
        recorded_on=recorded,
        notes=data.get("notes"),
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.delete("/<int:rec_id>")
@require_auth
def delete_entry(rec_id):
    rec = db.session.get(FicoEntry, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)
