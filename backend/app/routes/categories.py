"""Spending categories + learned merchant rules (CRUD), and retroactive apply."""
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from ..models import db, SpendingCategory, MerchantRule, ImportedTransaction
from ..services import categorize as cat_svc
from ._helpers import require_auth

bp = Blueprint("categories", __name__, url_prefix="/api/categories")


def _seed_if_empty():
    cat_svc.seed_default_categories(db, SpendingCategory)


# --------------------------------------------------------------------------- #
# Categories
# --------------------------------------------------------------------------- #

@bp.get("")
@require_auth
def list_categories():
    _seed_if_empty()
    rows = (SpendingCategory.query
            .order_by(SpendingCategory.archived.asc(), SpendingCategory.sort_order.asc(),
                      SpendingCategory.name.asc())
            .all())
    return jsonify([c.to_dict() for c in rows])


@bp.post("")
@require_auth
def create_category():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="missing_name"), 400
    if SpendingCategory.query.filter(func.lower(SpendingCategory.name) == name.lower()).first():
        return jsonify(error="duplicate", message="A category with that name already exists."), 409
    nxt = (db.session.query(func.coalesce(func.max(SpendingCategory.sort_order), 0)).scalar() or 0) + 1
    c = SpendingCategory(name=name, color=(data.get("color") or None), sort_order=nxt,
                         reimbursable=bool(data.get("reimbursable")))
    db.session.add(c)
    db.session.commit()
    return jsonify(c.to_dict()), 201


@bp.put("/<int:cat_id>")
@require_auth
def update_category(cat_id):
    c = db.session.get(SpendingCategory, cat_id)
    if not c:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    old_name = c.name
    if "name" in data:
        new_name = (data.get("name") or "").strip()
        if not new_name:
            return jsonify(error="missing_name"), 400
        dupe = (SpendingCategory.query
                .filter(func.lower(SpendingCategory.name) == new_name.lower(),
                        SpendingCategory.id != cat_id).first())
        if dupe:
            return jsonify(error="duplicate"), 409
        c.name = new_name
    if "color" in data:
        c.color = data.get("color") or None
    if "archived" in data:
        c.archived = bool(data.get("archived"))
    if "chart_hidden" in data:
        c.chart_hidden = bool(data.get("chart_hidden"))
    if "reimbursable" in data:
        c.reimbursable = bool(data.get("reimbursable"))
    if "offset_category_id" in data:
        raw = data.get("offset_category_id")
        c.offset_category_id = int(raw) if raw not in (None, "", 0, "0") else None
    if "monthly_budget" in data:
        mb = data.get("monthly_budget")
        try:
            c.monthly_budget = round(abs(float(mb)), 2) if mb not in (None, "") else None
        except (TypeError, ValueError):
            return jsonify(error="bad_budget"), 400
    if "sort_order" in data:
        c.sort_order = int(data.get("sort_order") or 0)
    # Renaming a category re-labels the transactions and rules that used the old name.
    renamed = 0
    if c.name != old_name:
        renamed = (ImportedTransaction.query.filter_by(category=old_name)
                   .update({"category": c.name}, synchronize_session=False))
        MerchantRule.query.filter_by(category=old_name).update({"category": c.name},
                                                               synchronize_session=False)
    db.session.commit()
    return jsonify({**c.to_dict(), "transactions_relabeled": renamed})


@bp.delete("/<int:cat_id>")
@require_auth
def delete_category(cat_id):
    c = db.session.get(SpendingCategory, cat_id)
    if not c:
        return jsonify(error="not_found"), 404
    db.session.delete(c)
    db.session.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Learned merchant rules
# --------------------------------------------------------------------------- #

def _parse_amt(v):
    if v is None or v == "":
        return None
    try:
        return round(abs(float(v)), 2)
    except (TypeError, ValueError):
        return None


def _apply_rule_to_existing(keyword: str, category: str, min_amount, max_amount,
                            same_day_keyword=None) -> int:
    """Re-label every existing transaction whose description contains keyword,
    falls inside the amount band, and (if set) shares its date with another
    transaction matching same_day_keyword."""
    like = f"%{keyword.lower()}%"
    q = ImportedTransaction.query.filter(func.lower(ImportedTransaction.description).like(like))
    if min_amount is not None:
        q = q.filter(func.abs(ImportedTransaction.amount) > min_amount)
    if max_amount is not None:
        q = q.filter(func.abs(ImportedTransaction.amount) <= max_amount)
    if same_day_keyword:
        days = [d[0] for d in db.session.query(ImportedTransaction.date)
                .filter(func.lower(ImportedTransaction.description).like(f"%{same_day_keyword.lower()}%"))
                .distinct().all()]
        if not days:
            return 0
        q = q.filter(ImportedTransaction.date.in_(days))
    return q.update({"category": category}, synchronize_session=False)


@bp.post("/recategorize")
@require_auth
def recategorize_all():
    """Re-run categorization over every saved transaction using the current
    learned rules + built-in matcher. Useful after importing with old labels or
    after adding several rules. Overwrites existing categories (including manual
    one-off edits), so it's an explicit, user-triggered action."""
    rules = MerchantRule.query.all()
    txns = ImportedTransaction.query.all()
    # Group descriptions by date so co-occurrence rules (e.g. "same day as Aldi")
    # can see the day's other transactions.
    by_date: dict = {}
    for t in txns:
        by_date.setdefault(t.date, []).append((t.description or "").lower())
    updated = 0
    for t in txns:
        new_cat = cat_svc.categorize(t.description, float(t.amount or 0), rules,
                                     same_day_descs=by_date.get(t.date))
        if new_cat != t.category:
            t.category = new_cat
            updated += 1
    db.session.commit()
    return jsonify(updated=updated, total=len(txns))


@bp.get("/rules")
@require_auth
def list_rules():
    rows = MerchantRule.query.order_by(MerchantRule.keyword.asc()).all()
    return jsonify([r.to_dict() for r in rows])


@bp.post("/rules")
@require_auth
def create_rule():
    data = request.get_json(silent=True) or {}
    keyword = (data.get("keyword") or "").strip().lower()
    category = (data.get("category") or "").strip()
    if not keyword or not category:
        return jsonify(error="missing_fields", message="keyword and category are required."), 400
    min_amount = _parse_amt(data.get("min_amount"))
    max_amount = _parse_amt(data.get("max_amount"))
    same_day = (data.get("same_day_keyword") or "").strip().lower() or None
    # Upsert on the full (keyword, band, same-day) identity so a merchant can hold
    # several conditional rules, but re-teaching the same one just updates it.
    existing = MerchantRule.query.filter_by(
        keyword=keyword, min_amount=min_amount, max_amount=max_amount,
        same_day_keyword=same_day).first()
    if existing:
        existing.category = category
        rule = existing
    else:
        rule = MerchantRule(keyword=keyword, category=category, min_amount=min_amount,
                            max_amount=max_amount, same_day_keyword=same_day)
        db.session.add(rule)
    updated = 0
    if data.get("apply_existing", True):
        updated = _apply_rule_to_existing(keyword, category, min_amount, max_amount, same_day)
    db.session.commit()
    return jsonify({**rule.to_dict(), "transactions_updated": updated}), 201


@bp.put("/rules/<int:rule_id>")
@require_auth
def update_rule(rule_id):
    rule = db.session.get(MerchantRule, rule_id)
    if not rule:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    if "keyword" in data:
        kw = (data.get("keyword") or "").strip().lower()
        if not kw:
            return jsonify(error="missing_keyword"), 400
        rule.keyword = kw
    if "category" in data:
        cat = (data.get("category") or "").strip()
        if not cat:
            return jsonify(error="missing_category"), 400
        rule.category = cat
    if "min_amount" in data:
        rule.min_amount = _parse_amt(data.get("min_amount"))
    if "max_amount" in data:
        rule.max_amount = _parse_amt(data.get("max_amount"))
    if "same_day_keyword" in data:
        rule.same_day_keyword = (data.get("same_day_keyword") or "").strip().lower() or None
    updated = 0
    if data.get("apply_existing", True):
        updated = _apply_rule_to_existing(rule.keyword, rule.category, rule.min_amount,
                                          rule.max_amount, rule.same_day_keyword)
    db.session.commit()
    return jsonify({**rule.to_dict(), "transactions_updated": updated})


@bp.delete("/rules/<int:rule_id>")
@require_auth
def delete_rule(rule_id):
    rule = db.session.get(MerchantRule, rule_id)
    if not rule:
        return jsonify(error="not_found"), 404
    db.session.delete(rule)
    db.session.commit()
    return jsonify(ok=True)
