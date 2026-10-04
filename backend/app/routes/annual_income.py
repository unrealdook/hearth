"""Annual gross income history — one figure per year for long-horizon trending."""
from flask import Blueprint, request, jsonify
from ..models import db, AnnualIncome, AppSetting
from ._helpers import require_auth

bp = Blueprint("annual_income", __name__, url_prefix="/api/annual-income")

# Who the two income columns belong to. Stored as settings rather than baked
# into the schema so the app isn't tied to one household.
SELF_LABEL_KEY = "income_self_label"
PARTNER_LABEL_KEY = "income_partner_label"
DEFAULT_SELF_LABEL = "Me"
DEFAULT_PARTNER_LABEL = "Partner"


def _label(key, fallback):
    s = db.session.get(AppSetting, key)
    return (s.value.strip() if s and s.value and s.value.strip() else fallback)


def _labels():
    return {
        "self_label": _label(SELF_LABEL_KEY, DEFAULT_SELF_LABEL),
        "partner_label": _label(PARTNER_LABEL_KEY, DEFAULT_PARTNER_LABEL),
    }


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


@bp.get("")
@require_auth
def list_entries():
    rows = AnnualIncome.query.order_by(AnnualIncome.year.asc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def upsert_entry():
    """Create or update by year — one row per year, so re-adding a year edits it."""
    data = request.get_json(silent=True) or {}
    try:
        year = int(data.get("year"))
    except (TypeError, ValueError):
        return jsonify(error="bad_year", message="A valid year is required"), 400
    gross = _num(data.get("gross_amount"))
    partner = _num(data.get("partner_amount"))
    if gross is None and partner is None and "partner_amount" not in data:
        return jsonify(error="bad_amount", message="At least one amount is required"), 400

    rec = AnnualIncome.query.filter_by(year=year).first()
    created = rec is None
    if rec is None:
        if gross is None and partner is None:
            return jsonify(error="bad_amount", message="At least one amount is required"), 400
        rec = AnnualIncome(year=year, gross_amount=0)
        db.session.add(rec)
    if gross is not None:
        rec.gross_amount = gross
    if "partner_amount" in data:
        rec.partner_amount = partner  # explicit key with empty value clears it
    if "notes" in data:
        rec.notes = data.get("notes") or None
    db.session.commit()
    return jsonify(rec.to_dict()), (201 if created else 200)


@bp.put("/<int:rec_id>")
@require_auth
def update_entry(rec_id):
    rec = db.session.get(AnnualIncome, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "year" in data:
        try:
            rec.year = int(data["year"])
        except (TypeError, ValueError):
            return jsonify(error="bad_year"), 400
    if "gross_amount" in data:
        g = _num(data["gross_amount"])
        if g is not None:
            rec.gross_amount = g
    if "partner_amount" in data:
        rec.partner_amount = _num(data["partner_amount"])
    if "notes" in data:
        rec.notes = data.get("notes") or None
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/<int:rec_id>")
@require_auth
def delete_entry(rec_id):
    rec = db.session.get(AnnualIncome, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)


@bp.get("/labels")
@require_auth
def get_labels():
    return jsonify(_labels())


@bp.put("/labels")
@require_auth
def set_labels():
    """Name the two earners. Blank restores the generic default."""
    data = request.get_json(silent=True) or {}
    for field, key in (("self_label", SELF_LABEL_KEY), ("partner_label", PARTNER_LABEL_KEY)):
        if field not in data:
            continue
        value = (data.get(field) or "").strip()[:40] or None
        row = db.session.get(AppSetting, key)
        if row is None:
            db.session.add(AppSetting(key=key, value=value))
        else:
            row.value = value
    db.session.commit()
    return jsonify(_labels())
