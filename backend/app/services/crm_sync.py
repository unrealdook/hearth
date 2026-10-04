"""Pull side-business billing out of the Sales CRM.

The CRM is the system of record for what was worked and what was invoiced; the
Business > Billing page used to be a hand-typed copy of it. This service reads
the CRM's read-only /api/v1 endpoint and mirrors each linked engagement's
billing periods into Hearth's Project / WorkEntry tables.

Linking is explicit: a Hearth project only tracks a CRM engagement once
`project.crm_opportunity_id` is set (via the UI). Nothing is auto-created and
nothing hand-entered is touched unless it was adopted into a link.

What a sync writes, per linked project:
  - hours, billed amount, and note, from the CRM period
  - `invoiced`, from whether the CRM has an invoice for that work
  - `paid` only ever goes false -> true. Hearth mirrors paid months into
    IncomeEvents, and the CRM lags on marking payment received; letting a sync
    un-pay a month would silently delete recorded income.
"""
from datetime import datetime

import requests

from ..models import db, Project, WorkEntry, AppSetting

CRM_URL_KEY = "crm_base_url"
CRM_KEY_KEY = "crm_api_key"

DEFAULT_URL = "http://127.0.0.1:5000"
TIMEOUT = 15


class CrmError(Exception):
    """Anything that stopped us reaching or reading the CRM."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _setting(key, default=None):
    s = db.session.get(AppSetting, key)
    return (s.value if s and s.value else None) or default


def get_settings():
    return {
        "base_url": _setting(CRM_URL_KEY, DEFAULT_URL),
        # Never echo the key back to the browser — only whether one is stored.
        "has_key": bool(_setting(CRM_KEY_KEY)),
    }


def save_settings(base_url=None, api_key=None):
    if base_url is not None:
        _put(CRM_URL_KEY, base_url.strip().rstrip("/") or DEFAULT_URL)
    if api_key is not None:
        _put(CRM_KEY_KEY, api_key.strip() or None)
    db.session.commit()
    return get_settings()


def _put(key, value):
    s = db.session.get(AppSetting, key)
    if s is None:
        db.session.add(AppSetting(key=key, value=value))
    else:
        s.value = value


def _get(path, params=None):
    base = _setting(CRM_URL_KEY, DEFAULT_URL)
    key = _setting(CRM_KEY_KEY)
    if not key:
        raise CrmError("no_api_key", "No CRM API key saved yet. Add one in Billing > CRM setup.")
    try:
        resp = requests.get(f"{base}/api/v1{path}", params=params, timeout=TIMEOUT,
                            headers={"Authorization": f"Bearer {key}"})
    except requests.RequestException:
        raise CrmError("unreachable", f"Couldn't reach the CRM at {base}. Is it running?")
    if resp.status_code == 401:
        raise CrmError("unauthorized", "The CRM rejected the API key.")
    if resp.status_code == 503:
        raise CrmError("crm_not_configured",
                       "The CRM hasn't generated an API key yet (flask crm-api-key).")
    if not resp.ok:
        raise CrmError("bad_response", f"CRM returned HTTP {resp.status_code}.")
    try:
        return resp.json()
    except ValueError:
        raise CrmError("bad_response", "CRM returned a non-JSON response.")


def ping():
    _get("/ping")
    return True


def fetch_engagements():
    payload = _get("/billing/engagements")
    return payload.get("engagements", []), payload.get("generated_at")


def engagements_with_links():
    """CRM engagements annotated with the Hearth project each is linked to, plus
    a suggested project for the unlinked ones so the first setup is one click."""
    engagements, generated_at = fetch_engagements()
    projects = Project.query.all()
    by_crm_id = {p.crm_opportunity_id: p for p in projects if p.crm_opportunity_id}
    by_name = {(p.name or "").strip().lower(): p for p in projects}

    out = []
    for eng in engagements:
        linked = by_crm_id.get(eng["crm_opportunity_id"])
        suggestion = None
        if linked is None:
            match = by_name.get((eng.get("name") or "").strip().lower())
            # Don't suggest a project that's already spoken for.
            if match is not None and not match.crm_opportunity_id:
                suggestion = {"id": match.id, "name": match.name}
        out.append({
            **eng,
            "linked_project": ({"id": linked.id, "name": linked.name} if linked else None),
            "suggested_project": suggestion,
        })
    return {
        "generated_at": generated_at,
        "engagements": out,
        "projects": [{"id": p.id, "name": p.name, "customer": p.customer,
                      "crm_opportunity_id": p.crm_opportunity_id}
                     for p in sorted(projects, key=lambda x: (x.name or "").lower())],
    }


def link(crm_opportunity_id, project_id):
    """Point a Hearth project at a CRM engagement (project_id None unlinks)."""
    # A CRM engagement can only back one project, so clear any prior holder.
    for p in Project.query.filter_by(crm_opportunity_id=crm_opportunity_id).all():
        p.crm_opportunity_id = None
        p.crm_synced_at = None
    if project_id is not None:
        project = db.session.get(Project, project_id)
        if project is None:
            raise CrmError("project_not_found", "That Hearth project no longer exists.")
        project.crm_opportunity_id = crm_opportunity_id
    db.session.commit()


def create_project_from(engagement):
    """Make a Hearth project for a CRM engagement and link the two."""
    project = Project(
        name=engagement.get("name") or "Untitled engagement",
        customer=engagement.get("customer") or None,
        hourly_rate=engagement.get("hourly_rate") or 0,
        is_active=True,
        crm_opportunity_id=engagement["crm_opportunity_id"],
    )
    db.session.add(project)
    db.session.commit()
    return project


def sync(sync_income_fn):
    """Refresh every linked project from the CRM.

    `sync_income_fn(entry, project)` is the Business blueprint's income mirror —
    injected so this service doesn't import the route layer back.
    """
    engagements, generated_at = fetch_engagements()
    by_crm_id = {e["crm_opportunity_id"]: e for e in engagements}

    linked = Project.query.filter(Project.crm_opportunity_id.isnot(None)).all()
    if not linked:
        return {"generated_at": generated_at, "projects": [], "created": 0,
                "updated": 0, "unchanged": 0, "missing": []}

    created = updated = unchanged = 0
    results = []
    missing = []

    for project in linked:
        engagement = by_crm_id.get(project.crm_opportunity_id)
        if engagement is None:
            missing.append({"project_id": project.id, "project": project.name,
                            "crm_opportunity_id": project.crm_opportunity_id})
            continue

        p_created = p_updated = p_unchanged = 0
        for period in engagement.get("periods", []):
            outcome = _apply_period(project, period, sync_income_fn)
            if outcome == "created":
                p_created += 1
            elif outcome == "updated":
                p_updated += 1
            else:
                p_unchanged += 1

        # Keep the rate in step so manual months added later bill correctly.
        rate = engagement.get("hourly_rate")
        if rate and float(project.hourly_rate or 0) != float(rate):
            project.hourly_rate = rate
        if engagement.get("customer") and not project.customer:
            project.customer = engagement["customer"]
        project.crm_synced_at = datetime.utcnow()

        created += p_created
        updated += p_updated
        unchanged += p_unchanged
        results.append({
            "project_id": project.id,
            "project": project.name,
            "crm_name": engagement.get("name"),
            "created": p_created,
            "updated": p_updated,
            "unchanged": p_unchanged,
        })

    db.session.commit()
    return {"generated_at": generated_at, "projects": results, "created": created,
            "updated": updated, "unchanged": unchanged, "missing": missing}


def _apply_period(project, period, sync_income_fn):
    """Upsert one CRM billing period onto the project. Returns what happened."""
    year, month = int(period["year"]), int(period["month"])

    # Prefer the CRM ref so a period that shifts months still updates in place,
    # then fall back to the (project, year, month) slot the table is keyed on.
    entry = None
    ref = period.get("ref")
    if ref:
        entry = WorkEntry.query.filter_by(project_id=project.id, crm_ref=ref).first()
    if entry is None:
        entry = WorkEntry.query.filter_by(project_id=project.id, year=year, month=month).first()

    created = entry is None
    if created:
        entry = WorkEntry(project_id=project.id, year=year, month=month)
        db.session.add(entry)

    hours = round(float(period.get("hours") or 0), 2)
    amount = round(float(period.get("amount") or 0), 2)
    rate = float(project.hourly_rate or 0)
    # Only carry an override when hours x rate genuinely can't express the total
    # (blended rates), so ordinary months keep behaving like hand-entered ones.
    override = None if rate and abs(hours * rate - amount) < 0.01 else amount

    before = (float(entry.hours or 0), entry.note, bool(entry.invoiced), bool(entry.paid),
              float(entry.amount_override) if entry.amount_override is not None else None,
              entry.year, entry.month)

    entry.year = year
    entry.month = month
    entry.hours = hours
    entry.note = period.get("note") or None
    entry.invoiced = bool(period.get("invoiced"))
    # Never un-pay: doing so would delete the mirrored IncomeEvent for money
    # that was actually received.
    if period.get("paid"):
        entry.paid = True
    entry.amount_override = override
    entry.source = "crm"
    entry.crm_ref = ref

    after = (float(entry.hours or 0), entry.note, bool(entry.invoiced), bool(entry.paid),
             float(entry.amount_override) if entry.amount_override is not None else None,
             entry.year, entry.month)

    sync_income_fn(entry, project)

    if created:
        return "created"
    return "updated" if before != after else "unchanged"
