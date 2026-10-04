"""Give events — donations, tithes, gifts.

Each event can optionally have one photo attached. Photos live on disk under
data/give_photos/<event_id>/<filename>, never in the DB. Only one photo per
event for now — uploading a new one replaces the old.
"""
import os
import shutil
from datetime import date, datetime
from pathlib import Path
from flask import Blueprint, request, jsonify, current_app, send_file, abort
from sqlalchemy import extract
from werkzeug.utils import secure_filename
from ..models import db, GiveEvent
from ._helpers import require_auth

bp = Blueprint("give", __name__, url_prefix="/api/give")


ALLOWED_CATEGORIES = {"church", "charity", "missions", "person", "other"}
ALLOWED_PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}
MAX_PHOTO_BYTES = 15 * 1024 * 1024  # 15 MB


def _photos_root() -> Path:
    return Path(current_app.config["DATA_DIR"]) / "give_photos"


def _event_dir(event_id: int) -> Path:
    return _photos_root() / str(event_id)


def _parse_date(s, default=None):
    if not s:
        return default
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return default


@bp.get("")
@require_auth
def list_give():
    year = request.args.get("year", type=int)
    q = GiveEvent.query
    if year:
        q = q.filter(extract("year", GiveEvent.occurred_on) == year)
    rows = q.order_by(GiveEvent.occurred_on.desc(), GiveEvent.id.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def create_give():
    data = request.get_json(silent=True) or {}
    if not (data.get("recipient") or "").strip():
        return jsonify(error="missing_recipient"), 400
    category = (data.get("category") or "other").strip()
    if category not in ALLOWED_CATEGORIES:
        return jsonify(error="invalid_category"), 400
    try:
        amount = float(data.get("amount") or 0)
    except (TypeError, ValueError):
        return jsonify(error="invalid_amount"), 400
    rec = GiveEvent(
        occurred_on=_parse_date(data.get("occurred_on"), default=date.today()),
        amount=amount,
        recipient=data["recipient"].strip(),
        category=category,
        note=(data.get("note") or None),
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/<int:rec_id>")
@require_auth
def update_give(rec_id):
    rec = db.session.get(GiveEvent, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "category" in data and data["category"] not in ALLOWED_CATEGORIES:
        return jsonify(error="invalid_category"), 400
    for f in ("recipient", "category", "note"):
        if f in data:
            setattr(rec, f, data[f])
    if "amount" in data:
        try:
            rec.amount = float(data["amount"] or 0)
        except (TypeError, ValueError):
            return jsonify(error="invalid_amount"), 400
    if "occurred_on" in data:
        parsed = _parse_date(data["occurred_on"])
        if parsed:
            rec.occurred_on = parsed
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/<int:rec_id>")
@require_auth
def delete_give(rec_id):
    rec = db.session.get(GiveEvent, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    # tidy up any attached photo directory
    d = _event_dir(rec.id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)


# ---- photo upload / serve ----------------------------------------------------

@bp.post("/<int:rec_id>/photo")
@require_auth
def upload_photo(rec_id):
    rec = db.session.get(GiveEvent, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    f = request.files.get("photo")
    if not f or not f.filename:
        return jsonify(error="missing_file"), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_PHOTO_EXTS:
        return jsonify(error="unsupported_type",
                       message=f"Allowed: {sorted(ALLOWED_PHOTO_EXTS)}"), 400
    # crude size check — read into memory once
    blob = f.read()
    if len(blob) > MAX_PHOTO_BYTES:
        return jsonify(error="too_large", message="Max 15 MB"), 400

    # wipe any prior photo for this event (single-photo model)
    d = _event_dir(rec_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)

    safe = secure_filename(f.filename) or f"photo{ext}"
    target = d / safe
    target.write_bytes(blob)

    # store relative path so the data dir can move without breaking refs
    rec.photo_path = f"give_photos/{rec_id}/{safe}"
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.get("/<int:rec_id>/photo")
@require_auth
def get_photo(rec_id):
    rec = db.session.get(GiveEvent, rec_id)
    if not rec or not rec.photo_path:
        abort(404)
    full = Path(current_app.config["DATA_DIR"]) / rec.photo_path
    if not full.exists() or not str(full.resolve()).startswith(str(_photos_root().resolve())):
        abort(404)
    return send_file(str(full))


@bp.delete("/<int:rec_id>/photo")
@require_auth
def delete_photo(rec_id):
    rec = db.session.get(GiveEvent, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    d = _event_dir(rec_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    rec.photo_path = None
    db.session.commit()
    return jsonify(rec.to_dict())
