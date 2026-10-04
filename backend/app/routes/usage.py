"""Utility usage readings — track consumption (kWh, gallons, …) and cost over
time so you can trend usage independent of price."""
import csv
import io
from datetime import date as date_cls, datetime
from collections import defaultdict
from flask import Blueprint, request, jsonify
from ..models import db, UtilityReading
from ..services import usage_parse
from ._helpers import require_auth

bp = Blueprint("usage", __name__, url_prefix="/api/usage")

UTILITY_TYPES = {"electric", "water", "gas", "internet", "trash", "sewer", "phone", "other"}


def _parse_date(value):
    if not value:
        return None
    value = str(value).strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


@bp.get("")
@require_auth
def list_readings():
    q = UtilityReading.query
    utype = request.args.get("utility_type")
    if utype:
        q = q.filter_by(utility_type=utype)
    rows = q.order_by(UtilityReading.period_end.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("")
@require_auth
def create_reading():
    data = request.get_json(silent=True) or {}
    period_end = _parse_date(data.get("period_end"))
    if not period_end:
        return jsonify(error="missing_period_end", message="period_end (the statement end date) is required"), 400
    utype = (data.get("utility_type") or "electric").lower()
    rec = UtilityReading(
        utility_type=utype if utype in UTILITY_TYPES else "other",
        bill_id=data.get("bill_id") or None,
        period_start=_parse_date(data.get("period_start")),
        period_end=period_end,
        usage=_num(data.get("usage")),
        unit=(data.get("unit") or None),
        cost=_num(data.get("cost")) or 0,
        notes=data.get("notes"),
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/<int:rec_id>")
@require_auth
def update_reading(rec_id):
    rec = db.session.get(UtilityReading, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "utility_type" in data:
        utype = (data.get("utility_type") or "other").lower()
        rec.utility_type = utype if utype in UTILITY_TYPES else "other"
    if "bill_id" in data:
        rec.bill_id = data.get("bill_id") or None
    if "period_start" in data:
        rec.period_start = _parse_date(data.get("period_start"))
    if "period_end" in data:
        pe = _parse_date(data.get("period_end"))
        if pe:
            rec.period_end = pe
    if "usage" in data:
        rec.usage = _num(data.get("usage"))
    if "unit" in data:
        rec.unit = data.get("unit") or None
    if "cost" in data:
        rec.cost = _num(data.get("cost")) or 0
    if "notes" in data:
        rec.notes = data.get("notes")
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/<int:rec_id>")
@require_auth
def delete_reading(rec_id):
    rec = db.session.get(UtilityReading, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)


@bp.delete("")
@require_auth
def delete_all():
    """Delete every reading for a utility type, e.g. to clear a mislabeled import.
    Requires ?utility_type= so we never wipe everything by accident."""
    utype = request.args.get("utility_type")
    if not utype:
        return jsonify(error="missing_type", message="Specify a utility_type to delete."), 400
    n = UtilityReading.query.filter_by(utility_type=utype).delete(synchronize_session=False)
    db.session.commit()
    return jsonify(deleted=n)


@bp.get("/trends")
@require_auth
def trends():
    """Per-utility-type time series for charting: usage, cost, cost-per-unit,
    plus a simple summary (latest vs trailing average) for anomaly hints."""
    rows = UtilityReading.query.order_by(UtilityReading.period_end.asc()).all()
    by_type: dict[str, list] = defaultdict(list)
    for r in rows:
        by_type[r.utility_type].append(r)

    out = []
    for utype, readings in by_type.items():
        points = []
        unit = None
        for r in readings:
            usage = float(r.usage) if r.usage is not None else None
            cost = float(r.cost or 0)
            if r.unit:
                unit = r.unit
            points.append({
                "id": r.id,
                "period_end": r.period_end.isoformat() if r.period_end else None,
                "usage": usage,
                "cost": cost,
                "cost_per_unit": round(cost / usage, 4) if usage else None,
            })
        # latest vs trailing average (of up to the prior 6 readings)
        latest = points[-1] if points else None
        prior = [p for p in points[:-1] if p["usage"] is not None][-6:]
        avg_usage = (sum(p["usage"] for p in prior) / len(prior)) if prior else None
        out.append({
            "utility_type": utype,
            "unit": unit,
            "count": len(points),
            "points": points,
            "latest_usage": latest["usage"] if latest else None,
            "avg_usage": round(avg_usage, 2) if avg_usage is not None else None,
        })
    out.sort(key=lambda x: x["utility_type"])
    return jsonify(out)


@bp.post("/parse")
@require_auth
def parse_upload():
    """Parse a usage file (CSV, ESPI/Green Button XML, or a usage-grid PDF) into
    proposed monthly readings for review. Saves nothing."""
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    raw = f.read()
    try:
        readings, meta = usage_parse.parse_file(f.filename, raw)
    except usage_parse.ParseError as e:
        return jsonify(error="parse_failed", message=str(e)), 422
    if not readings:
        return jsonify(error="no_readings", message="No usage rows found in that file."), 422
    meta["source_file"] = f.filename
    return jsonify({"readings": readings, "meta": meta})


@bp.post("/bulk")
@require_auth
def bulk_save():
    """Save a reviewed list of readings. Upserts by (utility_type, period_end) so
    re-importing the same months updates rather than duplicates."""
    data = request.get_json(silent=True) or {}
    rows = data.get("readings") or []
    created = 0
    updated = 0
    for r in rows:
        pe = _parse_date(r.get("period_end"))
        if not pe:
            continue
        utype = (r.get("utility_type") or "other").lower()
        if utype not in UTILITY_TYPES:
            utype = "other"
        existing = UtilityReading.query.filter_by(utility_type=utype, period_end=pe).first()
        if existing:
            existing.usage = _num(r.get("usage"))
            existing.unit = (r.get("unit") or existing.unit)
            existing.cost = _num(r.get("cost")) or 0
            updated += 1
        else:
            db.session.add(UtilityReading(
                utility_type=utype,
                period_start=_parse_date(r.get("period_start")),
                period_end=pe,
                usage=_num(r.get("usage")),
                unit=(r.get("unit") or None),
                cost=_num(r.get("cost")) or 0,
                source_file=data.get("source_file"),
            ))
            created += 1
    db.session.commit()
    return jsonify(created=created, updated=updated)


@bp.get("/insights")
@require_auth
def insights():
    """Decompose each utility's latest cost change into a usage effect vs a rate
    (price-per-unit) effect — Δ(usage·rate) = Δusage·old_rate + Δrate·new_usage —
    so you can tell 'I used more' apart from 'they raised the rate'."""
    by_type: dict[str, list] = defaultdict(list)
    for r in UtilityReading.query.order_by(UtilityReading.period_end.asc()).all():
        by_type[r.utility_type].append(r)

    def _decompose(new, old):
        u1, c1 = float(new.usage), float(new.cost)
        u0, c0 = float(old.usage), float(old.cost)
        r1, r0 = c1 / u1, c0 / u0
        return {
            "period_end": old.period_end.isoformat(),
            "usage_change_pct": round((u1 - u0) / u0 * 100, 1),
            "rate_change_pct": round((r1 - r0) / r0 * 100, 1),
            "cost_change": round(c1 - c0, 2),
            "usage_effect": round((u1 - u0) * r0, 2),   # change from using more/less
            "rate_effect": round((r1 - r0) * u1, 2),    # change from a higher/lower rate
        }

    out = []
    for utype, rows in by_type.items():
        usable = [r for r in rows if r.usage and float(r.usage) > 0 and r.cost and float(r.cost) > 0]
        if len(usable) < 2:
            continue
        latest, prior = usable[-1], usable[-2]
        item = {
            "utility_type": utype,
            "unit": latest.unit,
            "latest": {"period_end": latest.period_end.isoformat(),
                       "usage": round(float(latest.usage), 2),
                       "cost": round(float(latest.cost), 2),
                       "rate": round(float(latest.cost) / float(latest.usage), 4)},
            "vs_prior": _decompose(latest, prior),
        }
        yoy = next((r for r in reversed(usable[:-1])
                    if r.period_end.year == latest.period_end.year - 1
                    and r.period_end.month == latest.period_end.month), None)
        if yoy:
            item["vs_year_ago"] = _decompose(latest, yoy)
        out.append(item)
    out.sort(key=lambda x: x["utility_type"])
    return jsonify(out)


@bp.post("/import")
@require_auth
def import_csv():
    """Bulk import readings from a CSV. Recognized headers (case-insensitive):
    type/utility_type, period_start/start, period_end/end/date, usage, unit, cost/amount."""
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    try:
        text = f.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify(error="bad_encoding", message="Could not read the file as UTF-8 text"), 400

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return jsonify(error="empty_csv"), 400

    # normalize headers → canonical keys
    alias = {
        "type": "utility_type", "utility": "utility_type", "utility_type": "utility_type",
        "start": "period_start", "period_start": "period_start", "from": "period_start",
        "end": "period_end", "period_end": "period_end", "date": "period_end", "to": "period_end",
        "usage": "usage", "quantity": "usage", "qty": "usage", "consumption": "usage",
        "unit": "unit", "units": "unit",
        "cost": "cost", "amount": "cost", "total": "cost", "charge": "cost",
    }
    header_map = {h: alias.get((h or "").strip().lower()) for h in reader.fieldnames}

    created = 0
    skipped = 0
    errors = []
    for i, raw in enumerate(reader, start=2):  # row 1 is the header
        row = {}
        for h, val in raw.items():
            key = header_map.get(h)
            if key:
                row[key] = val
        period_end = _parse_date(row.get("period_end"))
        if not period_end:
            skipped += 1
            if len(errors) < 5:
                errors.append(f"Row {i}: missing/invalid end date")
            continue
        utype = (row.get("utility_type") or "other").strip().lower()
        rec = UtilityReading(
            utility_type=utype if utype in UTILITY_TYPES else "other",
            period_start=_parse_date(row.get("period_start")),
            period_end=period_end,
            usage=_num(row.get("usage")),
            unit=(row.get("unit") or None),
            cost=_num(row.get("cost")) or 0,
            source_file=f.filename,
        )
        db.session.add(rec)
        created += 1

    db.session.commit()
    return jsonify(created=created, skipped=skipped, errors=errors)
