"""Energy waste events — a lightweight ledger of wasted-energy spans pushed in
from a sibling app (the Home Automation dashboard) for monthly-bill reconciliation.

This is the ONE place a read-only API key is permitted to write (see
routes/_helpers.require_auth and _API_KEY_WRITABLE_BLUEPRINTS): the Home
Automation app POSTs waste events here with its X-Hearth-Api-Key. The data is
intentionally non-financial-core — it never feeds bills, payments, net worth,
or budgets — so allowing this narrow write does not expand the key's blast
radius into the rest of Hearth.

Payload accepted by POST /api/energy/waste-events:
    {
      "source":    "home-automation",          # optional, defaults to "home-automation"
      "device_id": "<opaque id>",               # optional
      "start":     "2026-05-31T12:00:00+00:00", # ISO 8601, required
      "end":       "2026-05-31T13:00:00+00:00", # ISO 8601, required
      "kwh":       1.23,                          # float, required, >= 0
      "cost":      0.18                           # float, required, >= 0
    }
"""
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from ..models import db, EnergyWasteEvent
from ._helpers import require_auth

# Blueprint name MUST be "energy" — _helpers._API_KEY_WRITABLE_BLUEPRINTS keys
# the write carve-out off request.blueprint.
bp = Blueprint("energy", __name__, url_prefix="/api/energy")


def _parse_dt(value):
    """Parse an ISO 8601 timestamp into a naive-UTC datetime (matching the rest
    of the app, which stores naive UTC via datetime.utcnow). Accepts a trailing
    'Z' and timezone offsets; tz-aware inputs are converted to UTC."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.endswith(("Z", "z")):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


@bp.post("/waste-events")
@require_auth
def create_waste_event():
    """Ingest one energy waste event. Returns the stored record with 201."""
    data = request.get_json(silent=True) or {}

    start = _parse_dt(data.get("start"))
    end = _parse_dt(data.get("end"))
    if start is None:
        return jsonify(error="bad_start", message="'start' must be an ISO 8601 timestamp"), 400
    if end is None:
        return jsonify(error="bad_end", message="'end' must be an ISO 8601 timestamp"), 400
    if end < start:
        return jsonify(error="bad_range", message="'end' must be at or after 'start'"), 400

    kwh = _num(data.get("kwh"))
    cost = _num(data.get("cost"))
    if kwh is None:
        return jsonify(error="bad_kwh", message="'kwh' is required and must be a number"), 400
    if cost is None:
        return jsonify(error="bad_cost", message="'cost' is required and must be a number"), 400
    if kwh < 0 or cost < 0:
        return jsonify(error="negative_value", message="'kwh' and 'cost' must be non-negative"), 400

    source = (data.get("source") or "home-automation")
    source = str(source).strip()[:64] or "home-automation"
    device_id = data.get("device_id")
    device_id = str(device_id).strip()[:64] if device_id not in (None, "") else None

    rec = EnergyWasteEvent(
        source=source,
        device_id=device_id,
        period_start=start,
        period_end=end,
        kwh=kwh,
        cost=cost,
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.get("/waste-events")
@require_auth
def list_waste_events():
    """List stored waste events, newest first.

    Query params:
        source   filter by source app (e.g. 'home-automation')
        start    only events whose period_end is on/after this ISO timestamp
        end      only events whose period_start is on/before this ISO timestamp
        limit    cap the number of rows returned (default 500, max 5000)
    """
    q = EnergyWasteEvent.query
    source = request.args.get("source")
    if source:
        q = q.filter(EnergyWasteEvent.source == source)
    start = _parse_dt(request.args.get("start"))
    if start is not None:
        q = q.filter(EnergyWasteEvent.period_end >= start)
    end = _parse_dt(request.args.get("end"))
    if end is not None:
        q = q.filter(EnergyWasteEvent.period_start <= end)

    try:
        limit = int(request.args.get("limit", 500))
    except (TypeError, ValueError):
        limit = 500
    limit = max(1, min(limit, 5000))

    rows = q.order_by(EnergyWasteEvent.period_start.desc()).limit(limit).all()
    return jsonify([r.to_dict() for r in rows])


@bp.get("/summary")
@require_auth
def waste_summary():
    """Aggregate wasted energy and cost, plus an optional per-month breakdown,
    for reconciling against utility bills.

    Query params:
        start / end   ISO timestamps to bound the window (optional)
    """
    q = db.session.query(
        func.count(EnergyWasteEvent.id),
        func.coalesce(func.sum(EnergyWasteEvent.kwh), 0),
        func.coalesce(func.sum(EnergyWasteEvent.cost), 0),
    )
    start = _parse_dt(request.args.get("start"))
    if start is not None:
        q = q.filter(EnergyWasteEvent.period_end >= start)
    end = _parse_dt(request.args.get("end"))
    if end is not None:
        q = q.filter(EnergyWasteEvent.period_start <= end)
    count, total_kwh, total_cost = q.one()

    # Per-month rollup keyed on period_start (YYYY-MM).
    by_month = {}
    rows = q.session.query(EnergyWasteEvent)
    if start is not None:
        rows = rows.filter(EnergyWasteEvent.period_end >= start)
    if end is not None:
        rows = rows.filter(EnergyWasteEvent.period_start <= end)
    for rec in rows.all():
        key = rec.period_start.strftime("%Y-%m") if rec.period_start else "unknown"
        bucket = by_month.setdefault(key, {"month": key, "events": 0, "kwh": 0.0, "cost": 0.0})
        bucket["events"] += 1
        bucket["kwh"] += float(rec.kwh or 0)
        bucket["cost"] += float(rec.cost or 0)

    months = [
        {**b, "kwh": round(b["kwh"], 4), "cost": round(b["cost"], 2)}
        for b in sorted(by_month.values(), key=lambda b: b["month"], reverse=True)
    ]
    return jsonify({
        "event_count": count,
        "total_kwh": round(float(total_kwh), 4),
        "total_cost": round(float(total_cost), 2),
        "by_month": months,
    })
