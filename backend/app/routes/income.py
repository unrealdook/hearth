from datetime import date, datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
from ..models import db, Income, IncomeEvent, AppSetting, Paycheck
from ..services import ollama_client, doc_extract, paystub
from ._helpers import require_auth

bp = Blueprint("income", __name__, url_prefix="/api/income")


def _active_model() -> str:
    setting = db.session.get(AppSetting, "ollama_model")
    if setting and setting.value:
        return setting.value
    return current_app.config["OLLAMA_MODEL"]


ALLOWED_KINDS = {"bonus", "commission", "payment", "tip", "other"}


def _parse_date(s, default=None):
    if not s:
        return default
    if isinstance(s, date) and not isinstance(s, datetime):
        return s
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return default


@bp.get("")
@require_auth
def list_income():
    year = request.args.get("year", type=int)
    q = Income.query
    if year:
        q = q.filter_by(year=year)
    rows = q.order_by(Income.year.desc(), Income.month.desc()).all()
    return jsonify([r.to_dict() for r in rows])


PAYCHECK_FIELDS = (
    "gross_amount", "federal_tax", "state_tax", "fica",
    "retirement_401k_amount", "health_insurance", "other_deductions",
    "paycheck_retirement_account_id",
)


def _coerce_decimal_or_none(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@bp.post("")
@require_auth
def create_income():
    data = request.get_json(silent=True) or {}
    if not data.get("source"):
        return jsonify(error="missing_source"), 400
    rec = Income(
        source=data["source"],
        amount=data.get("amount", 0),
        frequency=data.get("frequency", "monthly"),
        type=data.get("type", "salary"),
        month=data.get("month"),
        year=data.get("year"),
    )
    for f in PAYCHECK_FIELDS:
        if f in data:
            if f == "paycheck_retirement_account_id":
                rec.paycheck_retirement_account_id = data[f] or None
            else:
                setattr(rec, f, _coerce_decimal_or_none(data[f]))
    rec.start_date = _parse_date(data.get("start_date"))
    rec.end_date = _parse_date(data.get("end_date"))
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/<int:rec_id>")
@require_auth
def update_income(rec_id):
    rec = db.session.get(Income, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    for f in ("source", "amount", "frequency", "type", "month", "year"):
        if f in data:
            setattr(rec, f, data[f])
    for f in ("start_date", "end_date"):
        if f in data:
            setattr(rec, f, _parse_date(data[f]))
    for f in PAYCHECK_FIELDS:
        if f in data:
            if f == "paycheck_retirement_account_id":
                rec.paycheck_retirement_account_id = data[f] or None
            else:
                setattr(rec, f, _coerce_decimal_or_none(data[f]))
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/<int:rec_id>")
@require_auth
def delete_income(rec_id):
    rec = db.session.get(Income, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)


@bp.post("/<int:income_id>/raise")
@require_auth
def log_raise(income_id):
    """Record a pay raise by closing the current rate the day before the raise and
    starting a new entry from the effective date. Keeps history accurate: reports
    use the old rate before the raise and the new rate after."""
    old = db.session.get(Income, income_id)
    if not old:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    new_amount = _coerce_decimal_or_none(data.get("amount"))
    if new_amount is None:
        return jsonify(error="missing_amount", message="The new amount per check is required"), 400
    effective = _parse_date(data.get("effective_date"), default=date.today())

    # close the old rate the day before the raise takes effect
    old.end_date = effective - timedelta(days=1)

    new = Income(
        source=old.source,
        amount=new_amount,
        frequency=old.frequency,
        type=old.type,
        start_date=effective,
        end_date=None,
        paycheck_retirement_account_id=old.paycheck_retirement_account_id,
    )
    # If a new gross is given, carry the breakdown forward (deductions copied as a
    # starting point — the user can refine, e.g. by importing the new pay stub).
    new_gross = _coerce_decimal_or_none(data.get("gross_amount"))
    if new_gross is not None:
        new.gross_amount = new_gross
        for f in ("federal_tax", "state_tax", "fica", "retirement_401k_amount",
                  "health_insurance", "other_deductions"):
            setattr(new, f, getattr(old, f))
    db.session.add(new)
    db.session.commit()
    return jsonify(new.to_dict()), 201


# ---- one-off events (bonuses, commissions, irregular side payments) ----------

@bp.get("/events")
@require_auth
def list_all_events():
    """All events across all income sources. Used by the page to compute YTD rollups."""
    year = request.args.get("year", type=int)
    q = IncomeEvent.query
    if year:
        from sqlalchemy import extract
        q = q.filter(extract("year", IncomeEvent.occurred_on) == year)
    rows = q.order_by(IncomeEvent.occurred_on.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.get("/<int:income_id>/events")
@require_auth
def list_events(income_id):
    parent = db.session.get(Income, income_id)
    if not parent:
        return jsonify(error="not_found"), 404
    rows = (IncomeEvent.query
            .filter_by(income_id=income_id)
            .order_by(IncomeEvent.occurred_on.desc())
            .all())
    return jsonify([r.to_dict() for r in rows])


@bp.post("/<int:income_id>/events")
@require_auth
def create_event(income_id):
    parent = db.session.get(Income, income_id)
    if not parent:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    kind = (data.get("kind") or "payment").strip()
    if kind not in ALLOWED_KINDS:
        return jsonify(error="invalid_kind", message=f"kind must be one of {sorted(ALLOWED_KINDS)}"), 400
    occurred = _parse_date(data.get("occurred_on"), default=date.today())
    try:
        amount = float(data.get("amount") or 0)
    except (TypeError, ValueError):
        return jsonify(error="invalid_amount"), 400
    rec = IncomeEvent(
        income_id=income_id,
        occurred_on=occurred,
        amount=amount,
        gross_amount=_coerce_decimal_or_none(data.get("gross_amount")),
        kind=kind,
        note=(data.get("note") or None),
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(rec.to_dict()), 201


@bp.put("/events/<int:event_id>")
@require_auth
def update_event(event_id):
    rec = db.session.get(IncomeEvent, event_id)
    if not rec:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "kind" in data:
        kind = (data.get("kind") or "payment").strip()
        if kind not in ALLOWED_KINDS:
            return jsonify(error="invalid_kind"), 400
        rec.kind = kind
    if "occurred_on" in data:
        rec.occurred_on = _parse_date(data.get("occurred_on"), default=rec.occurred_on)
    if "amount" in data:
        try:
            rec.amount = float(data.get("amount") or 0)
        except (TypeError, ValueError):
            return jsonify(error="invalid_amount"), 400
    if "gross_amount" in data:
        rec.gross_amount = _coerce_decimal_or_none(data.get("gross_amount"))
    if "note" in data:
        rec.note = data.get("note") or None
    db.session.commit()
    return jsonify(rec.to_dict())


@bp.delete("/events/<int:event_id>")
@require_auth
def delete_event(event_id):
    rec = db.session.get(IncomeEvent, event_id)
    if not rec:
        return jsonify(error="not_found"), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)


# ---- pay stub / income document extraction (local LLM, review-before-save) ----

@bp.post("/parse-document")
@require_auth
def parse_document():
    """Extract structured data from an uploaded income document (pay stub, bonus
    statement, ACH/wire confirmation). Returns the parsed fields for review — does
    NOT save anything. The caller decides whether it's a recurring source or a
    one-off event and creates it via the normal endpoints."""
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    raw = f.read()
    text = doc_extract.extract_text(f.filename, raw)
    if not text:
        return jsonify(
            error="no_text",
            message=("This PDF has no readable text layer — it's either scanned or "
                     "uses encoded fonts (common with bank/payroll statements). "
                     "Try 'Download as PDF' from the payroll site if you saved it "
                     "from a browser print, or just type the values in below."),
        ), 422

    base_url = current_app.config["OLLAMA_URL"]
    if not ollama_client.is_running(base_url):
        return jsonify(error="ollama_unreachable",
                       message=f"Could not reach Ollama at {base_url}. Is `ollama serve` running?"), 503
    try:
        data = doc_extract.parse_income_document(text, base_url, _active_model())
    except ollama_client.OllamaError as e:
        return jsonify(error="ollama_error", message=str(e)), 502
    except doc_extract.ExtractError as e:
        return jsonify(error="extract_failed", message=str(e)), 422

    data["source_file"] = f.filename
    return jsonify(data)


# ---- paychecks (the actual per-check ledger) --------------------------------
# A recurring Income row is a *rate over a span*; it can't know when checks
# really land, which makes transition months wrong. A Paycheck is ground truth,
# and analytics prefers it for any employer that has one.

@bp.post("/paystub/parse")
@require_auth
def parse_paystub():
    """Read an uploaded pay stub and return it for review. Saves nothing."""
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    raw = f.read()
    try:
        data = paystub.parse(f.filename, raw)
    except Exception as exc:  # a malformed PDF shouldn't 500 the app
        current_app.logger.exception("paystub parse failed")
        return jsonify(error="parse_failed", message=f"Couldn't read that file: {exc}"), 422
    if not data.get("ok"):
        return jsonify(data), 422

    data["source_file"] = f.filename
    # Guess the employer's Income row so the review form pre-selects it.
    data["income_id"] = None
    employer = (data.get("employer") or "").lower()
    if employer:
        for inc in Income.query.all():
            src = (inc.source or "").lower()
            if src and (src in employer or employer.split()[0] in src):
                data["income_id"] = inc.id
                break
    if data.get("check_date"):
        fp = paystub.fingerprint(data.get("employer"), data["check_date"], data.get("net"))
        existing = Paycheck.query.filter_by(fingerprint=fp).first()
        data["already_imported"] = existing.id if existing else None
    return jsonify(data)


def _f(data, key):
    v = data.get(key)
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@bp.get("/paychecks")
@require_auth
def list_paychecks():
    year = request.args.get("year", type=int)
    q = Paycheck.query
    if year:
        q = q.filter(db.extract("year", Paycheck.check_date) == year)
    rows = q.order_by(Paycheck.check_date.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/paychecks")
@require_auth
def create_paycheck():
    """Save a reviewed paycheck. Idempotent on employer+date+net."""
    data = request.get_json(silent=True) or {}
    check_date = _parse_date(data.get("check_date"))
    if not check_date:
        return jsonify(error="missing_check_date", message="A check date is required."), 400
    net = _f(data, "net")
    if net is None:
        return jsonify(error="missing_net", message="Net pay is required."), 400

    employer = (data.get("employer") or "").strip() or None
    fp = paystub.fingerprint(employer, check_date.isoformat(), net)
    existing = Paycheck.query.filter_by(fingerprint=fp).first()
    if existing and not data.get("replace"):
        return jsonify(error="duplicate", message="That paycheck is already recorded.",
                       paycheck=existing.to_dict()), 409

    rec = existing or Paycheck(fingerprint=fp)
    rec.income_id = data.get("income_id") or None
    rec.employer = employer
    rec.check_date = check_date
    rec.period_start = _parse_date(data.get("period_start"))
    rec.period_end = _parse_date(data.get("period_end"))
    rec.gross = _f(data, "gross") or 0
    rec.net = net
    for field in ("bonus_gross", "federal_tax", "state_tax", "fica",
                  "retirement_401k", "health_insurance", "other_deductions"):
        setattr(rec, field, _f(data, field))
    rec.source_file = data.get("source_file")
    rec.note = data.get("note") or None
    if existing is None:
        db.session.add(rec)
    db.session.flush()

    # A bonus already sits inside this check's net. If it was also logged as a
    # standalone income event, link it so the month doesn't count it twice.
    absorbed = []
    if rec.income_id and rec.bonus_gross:
        events = (IncomeEvent.query
                  .filter_by(income_id=rec.income_id, occurred_on=check_date)
                  .filter(IncomeEvent.paycheck_id.is_(None)).all())
        for ev in events:
            ev.paycheck_id = rec.id
            absorbed.append(ev.id)

    db.session.commit()
    return jsonify({**rec.to_dict(), "absorbed_event_ids": absorbed}), 201


@bp.delete("/paychecks/<int:rec_id>")
@require_auth
def delete_paycheck(rec_id):
    rec = db.session.get(Paycheck, rec_id)
    if not rec:
        return jsonify(error="not_found"), 404
    # Release any events this check had absorbed so they count on their own again.
    for ev in IncomeEvent.query.filter_by(paycheck_id=rec_id).all():
        ev.paycheck_id = None
    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True)
