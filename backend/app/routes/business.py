"""Side-business projects + monthly work entries (hours x rate) for invoicing,
plus expenses with receipt attachments."""
import base64
import csv
import io
import secrets
from calendar import monthrange
from datetime import datetime, date
from pathlib import Path
from flask import Blueprint, request, jsonify, Response, current_app
from ..models import db, Project, WorkEntry, Income, IncomeEvent, AppSetting, BusinessExpense, Contractor
from ..services import invoice_pdf, crm_sync
from ._helpers import require_auth

bp = Blueprint("business", __name__, url_prefix="/api/business")

BUSINESS_INCOME_KEY = "business_income_id"
BUSINESS_FROM_KEY = "business_from"
BUSINESS_LOGO_KEY = "business_logo"
BUSINESS_PAYTO_KEY = "business_pay_to"

_IMG_MAGIC = [(b"\x89PNG", "image/png"), (b"\xff\xd8\xff", "image/jpeg"),
              (b"GIF8", "image/gif"), (b"RIFF", "image/webp")]


def _setting(key):
    s = db.session.get(AppSetting, key)
    return s.value if s else None


def _num(v, default=None):
    if v is None or v == "":
        return default
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return default


def _business_income():
    """The Income source that paid work logs into — created once and remembered."""
    s = db.session.get(AppSetting, BUSINESS_INCOME_KEY)
    if s and s.value:
        inc = db.session.get(Income, int(s.value))
        if inc:
            return inc
    inc = Income(source="Side business", amount=0, frequency="monthly", type="side_income")
    db.session.add(inc)
    db.session.flush()
    if s is None:
        db.session.add(AppSetting(key=BUSINESS_INCOME_KEY, value=str(inc.id)))
    else:
        s.value = str(inc.id)
    return inc


def _sync_income(entry: WorkEntry, project: Project):
    """Mirror a paid month into an IncomeEvent (and remove it when unpaid), so
    side-business cash counts toward take-home. Idempotent across edits."""
    amount = entry.effective_amount()
    if entry.paid and amount > 0:
        inc = _business_income()
        note = project.name + (f" ({project.customer})" if project.customer else "")
        note += f" — {date(entry.year, entry.month, 1).strftime('%b %Y')}"
        occ = date(entry.year, entry.month, min(15, monthrange(entry.year, entry.month)[1]))
        ev = db.session.get(IncomeEvent, entry.income_event_id) if entry.income_event_id else None
        if ev is None:
            ev = IncomeEvent(kind="payment")
            db.session.add(ev)
        ev.income_id = inc.id
        ev.occurred_on = occ
        ev.amount = amount
        ev.note = note
        db.session.flush()
        entry.income_event_id = ev.id
    else:
        # not paid (or zero) — remove any mirrored event
        if entry.income_event_id:
            ev = db.session.get(IncomeEvent, entry.income_event_id)
            if ev:
                db.session.delete(ev)
            entry.income_event_id = None


# ---- projects ---------------------------------------------------------------
@bp.get("/projects")
@require_auth
def list_projects():
    rows = Project.query.order_by(Project.is_active.desc(), Project.name.asc()).all()
    return jsonify([p.to_dict(with_totals=True) for p in rows])


@bp.post("/projects")
@require_auth
def create_project():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify(error="missing_name", message="A project name is required"), 400
    p = Project(
        customer=data.get("customer") or None,
        name=data["name"],
        hourly_rate=_num(data.get("hourly_rate"), 0),
        is_active=bool(data.get("is_active", True)),
        notes=data.get("notes") or None,
    )
    db.session.add(p)
    db.session.commit()
    return jsonify(p.to_dict(with_totals=True)), 201


@bp.put("/projects/<int:project_id>")
@require_auth
def update_project(project_id):
    p = db.session.get(Project, project_id)
    if not p:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "customer" in data:
        p.customer = data.get("customer") or None
    if "name" in data and data.get("name"):
        p.name = data["name"]
    if "hourly_rate" in data:
        p.hourly_rate = _num(data.get("hourly_rate"), 0)
    if "is_active" in data:
        p.is_active = bool(data["is_active"])
    if "notes" in data:
        p.notes = data.get("notes") or None
    db.session.commit()
    return jsonify(p.to_dict(with_totals=True))


@bp.delete("/projects/<int:project_id>")
@require_auth
def delete_project(project_id):
    p = db.session.get(Project, project_id)
    if not p:
        return jsonify(error="not_found"), 404
    db.session.delete(p)
    db.session.commit()
    return jsonify(ok=True)


# ---- work entries (one per project per month) -------------------------------
@bp.get("/projects/<int:project_id>/entries")
@require_auth
def list_entries(project_id):
    p = db.session.get(Project, project_id)
    if not p:
        return jsonify(error="not_found"), 404
    rows = (WorkEntry.query.filter_by(project_id=project_id)
            .order_by(WorkEntry.year.desc(), WorkEntry.month.desc()).all())
    return jsonify([e.to_dict() for e in rows])


@bp.post("/projects/<int:project_id>/entries")
@require_auth
def upsert_entry(project_id):
    """Create or update the month's entry (one per project per month)."""
    p = db.session.get(Project, project_id)
    if not p:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    now = datetime.utcnow()
    try:
        month = int(data.get("month") or now.month)
        year = int(data.get("year") or now.year)
    except (TypeError, ValueError):
        return jsonify(error="bad_period"), 400

    e = WorkEntry.query.filter_by(project_id=project_id, year=year, month=month).first()
    created = e is None
    if e is None:
        e = WorkEntry(project_id=project_id, year=year, month=month)
        db.session.add(e)
    if "hours" in data:
        e.hours = _num(data.get("hours"), 0)
    if "note" in data:
        e.note = data.get("note") or None
    if "invoiced" in data:
        e.invoiced = bool(data["invoiced"])
    if "paid" in data:
        e.paid = bool(data["paid"])
    _sync_income(e, p)
    db.session.commit()
    return jsonify(e.to_dict()), (201 if created else 200)


@bp.put("/entries/<int:entry_id>")
@require_auth
def update_entry(entry_id):
    e = db.session.get(WorkEntry, entry_id)
    if not e:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "year" in data:
        try:
            e.year = int(data["year"])
        except (TypeError, ValueError):
            return jsonify(error="bad_year"), 400
    if "month" in data:
        try:
            e.month = int(data["month"])
        except (TypeError, ValueError):
            return jsonify(error="bad_month"), 400
    if "hours" in data:
        e.hours = _num(data.get("hours"), 0)
    if "note" in data:
        e.note = data.get("note") or None
    if "invoiced" in data:
        e.invoiced = bool(data["invoiced"])
    if "paid" in data:
        e.paid = bool(data["paid"])
    if e.project:
        _sync_income(e, e.project)
    db.session.commit()
    return jsonify(e.to_dict())


@bp.delete("/entries/<int:entry_id>")
@require_auth
def delete_entry(entry_id):
    e = db.session.get(WorkEntry, entry_id)
    if not e:
        return jsonify(error="not_found"), 404
    # remove the mirrored income event too
    if e.income_event_id:
        ev = db.session.get(IncomeEvent, e.income_event_id)
        if ev:
            db.session.delete(ev)
    db.session.delete(e)
    db.session.commit()
    return jsonify(ok=True)


# ---- CRM sync ---------------------------------------------------------------
# The Sales CRM already tracks hours, invoices and payments for the same work.
# These endpoints let Billing pull from it instead of re-keying it by hand.

@bp.get("/crm/settings")
@require_auth
def crm_settings():
    return jsonify(crm_sync.get_settings())


@bp.put("/crm/settings")
@require_auth
def save_crm_settings():
    data = request.get_json(silent=True) or {}
    saved = crm_sync.save_settings(
        base_url=data.get("base_url") if "base_url" in data else None,
        api_key=data.get("api_key") if "api_key" in data else None,
    )
    return jsonify(saved)


@bp.get("/crm/engagements")
@require_auth
def crm_engagements():
    try:
        return jsonify(crm_sync.engagements_with_links())
    except crm_sync.CrmError as exc:
        return jsonify(error=exc.code, message=exc.message), 502


@bp.put("/crm/link")
@require_auth
def crm_link():
    """Link a CRM engagement to a Hearth project, or create one for it."""
    data = request.get_json(silent=True) or {}
    try:
        crm_id = int(data.get("crm_opportunity_id"))
    except (TypeError, ValueError):
        return jsonify(error="missing_crm_opportunity_id"), 400

    try:
        if data.get("create"):
            engagements, _ = crm_sync.fetch_engagements()
            match = next((e for e in engagements if e["crm_opportunity_id"] == crm_id), None)
            if match is None:
                return jsonify(error="engagement_not_found"), 404
            crm_sync.link(crm_id, None)
            project = crm_sync.create_project_from(match)
            return jsonify(project.to_dict(with_totals=True)), 201

        raw = data.get("project_id")
        crm_sync.link(crm_id, int(raw) if raw not in (None, "") else None)
        return jsonify(ok=True)
    except crm_sync.CrmError as exc:
        return jsonify(error=exc.code, message=exc.message), 502


@bp.post("/crm/sync")
@require_auth
def crm_sync_now():
    try:
        return jsonify(crm_sync.sync(_sync_income))
    except crm_sync.CrmError as exc:
        return jsonify(error=exc.code, message=exc.message), 502


@bp.get("/profile")
@require_auth
def get_profile():
    return jsonify({"from_text": _setting(BUSINESS_FROM_KEY) or "",
                    "logo": _setting(BUSINESS_LOGO_KEY),
                    "pay_to": _setting(BUSINESS_PAYTO_KEY) or ""})


@bp.post("/logo")
@require_auth
def upload_logo():
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    raw = f.read()
    if len(raw) > 2_000_000:
        return jsonify(error="too_large", message="Logo must be under 2 MB."), 400
    mime = next((m for magic, m in _IMG_MAGIC if raw.startswith(magic)), None)
    if not mime:
        return jsonify(error="not_image", message="Use a PNG, JPG, GIF or WebP image."), 400
    data_uri = f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
    s = db.session.get(AppSetting, BUSINESS_LOGO_KEY)
    if s is None:
        db.session.add(AppSetting(key=BUSINESS_LOGO_KEY, value=data_uri))
    else:
        s.value = data_uri
    db.session.commit()
    return jsonify(ok=True, logo=data_uri)


@bp.delete("/logo")
@require_auth
def delete_logo():
    s = db.session.get(AppSetting, BUSINESS_LOGO_KEY)
    if s:
        db.session.delete(s)
        db.session.commit()
    return jsonify(ok=True)


@bp.post("/projects/<int:project_id>/invoice")
@require_auth
def make_invoice(project_id):
    p = db.session.get(Project, project_id)
    if not p:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    ids = data.get("entry_ids") or []
    entries = [e for e in (db.session.get(WorkEntry, i) for i in ids)
               if e and e.project_id == project_id]
    if not entries:
        return jsonify(error="no_entries", message="Select at least one month to invoice."), 400
    entries.sort(key=lambda e: (e.year, e.month))

    rate = float(p.hourly_rate or 0)
    items = []
    total = 0.0
    for e in entries:
        amt = e.effective_amount()
        total += amt
        hours = float(e.hours or 0)
        items.append({
            "desc": f"Work — {date(e.year, e.month, 1).strftime('%B %Y')}",
            "note": e.note or "",
            "hours": hours,
            # A month synced from the CRM can blend rates; show the effective
            # one so hours x rate on the invoice still reconciles to the total.
            "rate": round(amt / hours, 2) if hours else rate,
            "amount": amt,
        })

    def _remember(key, value):
        value = (value or "").strip()
        s = db.session.get(AppSetting, key)
        if value:
            if s is None:
                db.session.add(AppSetting(key=key, value=value))
            else:
                s.value = value
            return value
        return s.value if s else ""

    from_text = _remember(BUSINESS_FROM_KEY, data.get("from_text"))
    pay_to = _remember(BUSINESS_PAYTO_KEY, data.get("pay_to"))

    subtotal = round(total, 2)
    discount = round(_num(data.get("discount"), 0) or 0, 2)
    tax_rate = _num(data.get("tax_rate"), 0) or 0
    taxable = max(0.0, subtotal - discount)
    tax_amount = round(taxable * tax_rate / 100.0, 2)
    grand_total = round(taxable + tax_amount, 2)

    ctx = {
        "number": (data.get("number") or f"{p.id}-{datetime.utcnow():%Y%m%d}"),
        "date": data.get("date") or datetime.utcnow().strftime("%Y-%m-%d"),
        "due": data.get("due") or "",
        "from_text": from_text,
        "bill_to": data.get("bill_to") or (p.customer or ""),
        "items": items,
        "subtotal": subtotal,
        "discount": discount,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "total": grand_total,
        "notes": data.get("notes") or "",
        "pay_to": pay_to,
        "logo": _setting(BUSINESS_LOGO_KEY),
        "paid": bool(entries) and all(e.paid for e in entries),
    }
    pdf = invoice_pdf.render_invoice(ctx)

    if data.get("mark_invoiced"):
        for e in entries:
            e.invoiced = True
    db.session.commit()

    fname = f"invoice-{ctx['number']}.pdf".replace(" ", "_").replace("/", "-")
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@bp.get("/summary")
@require_auth
def summary():
    projects = Project.query.all()
    year = date.today().year
    total_billed = uninvoiced = unpaid = total_hours = 0.0
    billed_ytd = collected_ytd = 0.0
    for p in projects:
        for e in p.entries:
            amt = e.effective_amount()
            total_billed += amt
            total_hours += float(e.hours or 0)
            if not e.invoiced:
                uninvoiced += amt
            if not e.paid:
                unpaid += amt
            if e.year == year:
                billed_ytd += amt
                if e.paid:
                    collected_ytd += amt

    expenses = BusinessExpense.query.all()
    expenses_total = sum(float(x.amount or 0) for x in expenses)
    ytd = [x for x in expenses if x.incurred_on and x.incurred_on.year == year]
    expenses_ytd = sum(float(x.amount or 0) for x in ytd)
    by_cat: dict[str, float] = {}
    for x in ytd:
        c = x.category or "Other"
        by_cat[c] = by_cat.get(c, 0.0) + float(x.amount or 0)

    tax_rate = _num(_setting(BUSINESS_TAXRATE_KEY), 25.0) or 25.0
    net_ytd = collected_ytd - expenses_ytd
    return jsonify({
        "project_count": len(projects),
        "active_count": sum(1 for p in projects if p.is_active),
        "total_hours": round(total_hours, 2),
        "total_billed": round(total_billed, 2),
        "uninvoiced": round(uninvoiced, 2),
        "unpaid": round(unpaid, 2),
        "year": year,
        "billed_ytd": round(billed_ytd, 2),
        "collected_ytd": round(collected_ytd, 2),
        "expenses_total": round(expenses_total, 2),
        "expenses_ytd": round(expenses_ytd, 2),
        # cash-basis: what actually landed minus what actually left
        "net_ytd": round(net_ytd, 2),
        "expenses_by_category_ytd": [
            {"category": c, "total": round(t, 2)}
            for c, t in sorted(by_cat.items(), key=lambda kv: -kv[1])
        ],
        "tax_rate_pct": round(tax_rate, 1),
        "est_tax_ytd": round(max(net_ytd, 0) * tax_rate / 100.0, 2),
    })


BUSINESS_TAXRATE_KEY = "business_tax_rate_pct"


@bp.post("/tax-rate")
@require_auth
def set_tax_rate():
    pct = _num((request.get_json(silent=True) or {}).get("pct"))
    if pct is None or pct < 0 or pct > 60:
        return jsonify(error="bad_rate", message="Rate must be between 0 and 60%."), 400
    s = db.session.get(AppSetting, BUSINESS_TAXRATE_KEY)
    if s is None:
        db.session.add(AppSetting(key=BUSINESS_TAXRATE_KEY, value=str(pct)))
    else:
        s.value = str(pct)
    db.session.commit()
    return jsonify(ok=True, tax_rate_pct=pct)


@bp.post("/export")
@require_auth
def export_csv():
    """Flat CSV of the year's business activity — revenue (work months),
    expenses, and status — plus a totals block. Body: {year?: int}."""
    data = request.get_json(silent=True) or {}
    year = int(data.get("year") or date.today().year)

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["date", "type", "party", "category", "description",
                "amount", "status", "receipt"])

    billed = collected = unpaid_total = expense_total = 0.0
    rows = []
    for p in Project.query.all():
        rate = float(p.hourly_rate or 0)
        party = p.name + (f" ({p.customer})" if p.customer else "")
        for e in p.entries:
            if e.year != year:
                continue
            amt = e.effective_amount()
            billed += amt
            hours = float(e.hours or 0)
            eff_rate = round(amt / hours, 2) if hours else rate
            status = "paid" if e.paid else ("invoiced, unpaid" if e.invoiced else "not invoiced")
            if e.paid:
                collected += amt
            else:
                unpaid_total += amt
            rows.append((date(e.year, e.month, 1).isoformat(), "revenue", party, "Billing",
                         f"{hours} hrs @ ${eff_rate:.2f}/hr" + (f" — {e.note}" if e.note else ""),
                         f"{amt:.2f}", status, ""))
    names = _project_names()
    for x in BusinessExpense.query.all():
        if not x.incurred_on or x.incurred_on.year != year:
            continue
        amt = float(x.amount or 0)
        expense_total += amt
        rows.append((x.incurred_on.isoformat(), "expense",
                     x.vendor or "", x.category or "Other",
                     (x.description or "") + (f" [project: {names[x.project_id]}]" if x.project_id in names else ""),
                     f"-{amt:.2f}", "", "yes" if x.receipt_path else "no"))

    rows.sort(key=lambda r: r[0])
    for r in rows:
        w.writerow(r)

    w.writerow([])
    w.writerow([f"TOTALS {year}"])
    w.writerow(["billed", f"{billed:.2f}"])
    w.writerow(["collected (revenue, cash basis)", f"{collected:.2f}"])
    w.writerow(["outstanding / not paid", f"{unpaid_total:.2f}"])
    w.writerow(["expenses", f"{expense_total:.2f}"])
    w.writerow(["net (collected - expenses)", f"{collected - expense_total:.2f}"])

    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="business-{year}.csv"'})


# ---- expenses (with receipt attachments) ------------------------------------

_RECEIPT_MAGIC = _IMG_MAGIC + [(b"%PDF", "application/pdf")]
_RECEIPT_MAX = 10_000_000  # 10 MB
_MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
             "image/webp": "webp", "application/pdf": "pdf"}


def _receipts_dir() -> Path:
    d = Path(current_app.config["DATA_DIR"]) / "receipts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _delete_receipt_file(x: BusinessExpense):
    if x.receipt_path:
        try:
            (_receipts_dir() / x.receipt_path).unlink(missing_ok=True)
        except OSError:
            pass
    x.receipt_path = None
    x.receipt_mime = None


def _store_receipt(x: BusinessExpense, f) -> str | None:
    """Validate + persist an uploaded receipt; returns an error string or None."""
    raw = f.read()
    if not raw:
        return "Empty file."
    if len(raw) > _RECEIPT_MAX:
        return "Receipt must be under 10 MB."
    mime = next((m for magic, m in _RECEIPT_MAGIC if raw.startswith(magic)), None)
    if not mime:
        return "Use a PNG, JPG, GIF, WebP image or a PDF."
    _delete_receipt_file(x)  # replace any old one
    fname = f"exp_{secrets.token_hex(8)}.{_MIME_EXT[mime]}"
    (_receipts_dir() / fname).write_bytes(raw)
    x.receipt_path = fname
    x.receipt_mime = mime
    return None


def _project_names() -> dict:
    return {p.id: p.name for p in Project.query.all()}


def _contractor_names() -> dict:
    return {c.id: c.name for c in Contractor.query.all()}


def _parse_expense_fields(x: BusinessExpense, data) -> str | None:
    """Apply submitted fields to an expense; returns an error string or None."""
    if "incurred_on" in data and data.get("incurred_on"):
        try:
            x.incurred_on = date.fromisoformat(str(data["incurred_on"])[:10])
        except ValueError:
            return "Bad date."
    if "vendor" in data:
        x.vendor = (data.get("vendor") or "").strip() or None
    if "description" in data:
        x.description = (data.get("description") or "").strip() or None
    if "amount" in data:
        x.amount = abs(_num(data.get("amount"), 0) or 0)
    if "category" in data:
        x.category = (data.get("category") or "").strip() or "Other"
    if "project_id" in data:
        raw = data.get("project_id")
        x.project_id = int(raw) if raw not in (None, "", 0, "0", "null") else None
    if "contractor_id" in data:
        raw = data.get("contractor_id")
        x.contractor_id = int(raw) if raw not in (None, "", 0, "0", "null") else None
    # A contractor payment defaults to the Contract Labor category and takes
    # the contractor's name as vendor unless one was typed.
    if x.contractor_id:
        c = db.session.get(Contractor, x.contractor_id)
        if c:
            if not x.vendor:
                x.vendor = c.name
            if x.category in (None, "", "Other"):
                x.category = "Contract Labor"
    return None


@bp.get("/expenses")
@require_auth
def list_expenses():
    """All expenses, newest first. ?year=YYYY to filter."""
    q = BusinessExpense.query
    year = request.args.get("year", type=int)
    if year:
        q = q.filter(BusinessExpense.incurred_on >= date(year, 1, 1),
                     BusinessExpense.incurred_on <= date(year, 12, 31))
    rows = q.order_by(BusinessExpense.incurred_on.desc(), BusinessExpense.id.desc()).all()
    names = _project_names()
    cnames = _contractor_names()
    return jsonify([x.to_dict(names, cnames) for x in rows])


@bp.post("/expenses")
@require_auth
def create_expense():
    """JSON body, or multipart with fields + an optional `receipt` file."""
    data = request.form if request.files or request.form else (request.get_json(silent=True) or {})
    x = BusinessExpense(incurred_on=date.today())
    err = _parse_expense_fields(x, data)
    if err:
        return jsonify(error="bad_fields", message=err), 400
    if float(x.amount or 0) <= 0:
        return jsonify(error="missing_amount", message="An amount is required."), 400
    f = request.files.get("receipt")
    if f:
        err = _store_receipt(x, f)
        if err:
            return jsonify(error="bad_receipt", message=err), 400
    db.session.add(x)
    db.session.commit()
    return jsonify(x.to_dict(_project_names(), _contractor_names())), 201


@bp.put("/expenses/<int:exp_id>")
@require_auth
def update_expense(exp_id):
    x = db.session.get(BusinessExpense, exp_id)
    if not x:
        return jsonify(error="not_found"), 404
    err = _parse_expense_fields(x, request.get_json(silent=True) or {})
    if err:
        return jsonify(error="bad_fields", message=err), 400
    db.session.commit()
    return jsonify(x.to_dict(_project_names(), _contractor_names()))


@bp.delete("/expenses/<int:exp_id>")
@require_auth
def delete_expense(exp_id):
    x = db.session.get(BusinessExpense, exp_id)
    if not x:
        return jsonify(error="not_found"), 404
    _delete_receipt_file(x)
    db.session.delete(x)
    db.session.commit()
    return jsonify(ok=True)


@bp.post("/expenses/<int:exp_id>/receipt")
@require_auth
def upload_receipt(exp_id):
    x = db.session.get(BusinessExpense, exp_id)
    if not x:
        return jsonify(error="not_found"), 404
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    err = _store_receipt(x, f)
    if err:
        return jsonify(error="bad_receipt", message=err), 400
    db.session.commit()
    return jsonify(x.to_dict(_project_names(), _contractor_names()))


@bp.delete("/expenses/<int:exp_id>/receipt")
@require_auth
def delete_receipt(exp_id):
    x = db.session.get(BusinessExpense, exp_id)
    if not x:
        return jsonify(error="not_found"), 404
    _delete_receipt_file(x)
    db.session.commit()
    return jsonify(x.to_dict(_project_names(), _contractor_names()))


# ---- contractors (subcontractor compliance + payment tracking) ---------------

# 1099-NEC reporting threshold for payments made in 2026+ (raised from $600 by
# the 2025 tax act; indexed going forward). Update as the IRS adjusts it.
THRESHOLD_1099 = 2000.0


@bp.get("/contractors")
@require_auth
def list_contractors():
    """Contractors with payment totals (from linked expenses) and 1099 status."""
    year = date.today().year
    rows = Contractor.query.order_by(Contractor.is_active.desc(), Contractor.name.asc()).all()
    expenses = BusinessExpense.query.filter(BusinessExpense.contractor_id.isnot(None)).all()
    out = []
    for c in rows:
        mine = [x for x in expenses if x.contractor_id == c.id]
        paid_total = sum(float(x.amount or 0) for x in mine)
        paid_ytd = sum(float(x.amount or 0) for x in mine
                       if x.incurred_on and x.incurred_on.year == year)
        out.append({
            **c.to_dict(),
            "payment_count": len(mine),
            "paid_total": round(paid_total, 2),
            "paid_ytd": round(paid_ytd, 2),
            "threshold_1099": THRESHOLD_1099,
            "needs_1099": paid_ytd >= THRESHOLD_1099,
        })
    return jsonify(out)


@bp.post("/contractors")
@require_auth
def create_contractor():
    data = request.get_json(silent=True) or {}
    if not (data.get("name") or "").strip():
        return jsonify(error="missing_name", message="A name is required."), 400
    c = Contractor(
        name=data["name"].strip(),
        contact=(data.get("contact") or "").strip() or None,
        notes=(data.get("notes") or "").strip() or None,
        w9_on_file=bool(data.get("w9_on_file")),
        is_active=bool(data.get("is_active", True)),
    )
    db.session.add(c)
    db.session.commit()
    return jsonify(c.to_dict()), 201


@bp.put("/contractors/<int:c_id>")
@require_auth
def update_contractor(c_id):
    c = db.session.get(Contractor, c_id)
    if not c:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "name" in data and (data.get("name") or "").strip():
        c.name = data["name"].strip()
    if "contact" in data:
        c.contact = (data.get("contact") or "").strip() or None
    if "notes" in data:
        c.notes = (data.get("notes") or "").strip() or None
    if "w9_on_file" in data:
        c.w9_on_file = bool(data["w9_on_file"])
    if "is_active" in data:
        c.is_active = bool(data["is_active"])
    db.session.commit()
    return jsonify(c.to_dict())


@bp.delete("/contractors/<int:c_id>")
@require_auth
def delete_contractor(c_id):
    c = db.session.get(Contractor, c_id)
    if not c:
        return jsonify(error="not_found"), 404
    # keep the payment history — just unlink it
    BusinessExpense.query.filter_by(contractor_id=c_id).update(
        {"contractor_id": None}, synchronize_session=False)
    db.session.delete(c)
    db.session.commit()
    return jsonify(ok=True)


@bp.get("/expenses/<int:exp_id>/receipt")
@require_auth
def view_receipt(exp_id):
    x = db.session.get(BusinessExpense, exp_id)
    if not x or not x.receipt_path:
        return jsonify(error="not_found"), 404
    path = _receipts_dir() / x.receipt_path
    if not path.exists():
        return jsonify(error="file_missing"), 404
    return Response(path.read_bytes(), mimetype=x.receipt_mime or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{x.receipt_path}"'})
