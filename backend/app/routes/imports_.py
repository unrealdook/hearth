"""Bank statement import + rule-based categorization + bill auto-match."""
import os
from datetime import datetime, date as date_cls
from sqlalchemy import or_, and_, func
from flask import Blueprint, request, jsonify, current_app
from ..models import (db, ImportedTransaction, Bill, PaymentRecord, MerchantRule,
                      SavingsAccount, AppSetting)
from ..services import parser as parse_svc
from ..services import matching
from ..services import categorize as cat_svc
from ._helpers import require_auth

bp = Blueprint("imports", __name__, url_prefix="/api/import")


@bp.post("/bank-statement")
@require_auth
def upload_statement():
    if "file" not in request.files:
        return jsonify(error="missing_file"), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify(error="empty_filename"), 400
    raw = f.read()
    # save a copy under imports/ for traceability
    safe = "".join(c for c in f.filename if c.isalnum() or c in (".", "-", "_")) or "statement"
    out = os.path.join(current_app.config["IMPORTS_DIR"], datetime.utcnow().strftime("%Y%m%d_%H%M%S_") + safe)
    with open(out, "wb") as fh:
        fh.write(raw)
    rows = parse_svc.parse_statement(f.filename, raw)
    if not rows:
        return jsonify(error="no_rows_parsed", saved_to=os.path.basename(out)), 422
    # Categorize with learned merchant rules first, then the built-in matcher.
    rules = MerchantRule.query.all()
    bills = Bill.query.filter_by(is_active=True).all()
    # Build same-day description context (for co-occurrence rules) from this
    # batch plus any already-saved transactions on the same dates.
    by_date: dict = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append((r["description"] or "").lower())
    try:
        dates = {date_cls.fromisoformat(d) for d in by_date}
        for t in ImportedTransaction.query.filter(ImportedTransaction.date.in_(dates)).all():
            by_date.setdefault(t.date.isoformat(), []).append((t.description or "").lower())
    except (ValueError, TypeError):
        pass
    # Flag rows already in the DB (by fingerprint) so the UI can hide them —
    # these are what /confirm would skip as duplicates anyway.
    fps = [r.get("fingerprint") for r in rows if r.get("fingerprint")]
    existing_fps = set()
    if fps:
        existing_fps = {
            row[0] for row in db.session.query(ImportedTransaction.fingerprint)
            .filter(ImportedTransaction.fingerprint.in_(fps)).all()
        }
    for r in rows:
        same_day = by_date.get(r["date"])
        r["category"] = cat_svc.categorize(r["description"], r["amount"], rules, same_day_descs=same_day)
        r["matched_bill_id"] = matching.match_bill(r["description"], r["amount"], bills)
        r["merchant"] = cat_svc.merchant_key(r["description"])
        r["suggest"] = cat_svc.suggest_keyword(r["description"])
        r["duplicate"] = r.get("fingerprint") in existing_fps
    new_count = sum(1 for r in rows if not r["duplicate"])
    return jsonify({"rows": rows, "source_file": os.path.basename(out),
                    "count": len(rows), "new_count": new_count,
                    "duplicate_count": len(rows) - new_count})


@bp.post("/confirm")
@require_auth
def confirm_import():
    """Persist the user-reviewed rows. Optionally mark matched bills as paid."""
    body = request.get_json(silent=True) or {}
    rows = body.get("rows") or []
    source_file = body.get("source_file")
    # Which account this statement belongs to. Defaults to the pay-from account
    # so existing single-account users don't have to think about it.
    account_id = body.get("account_id")
    try:
        account_id = int(account_id) if account_id not in (None, "") else None
    except (TypeError, ValueError):
        account_id = None
    if account_id is None:
        s = db.session.get(AppSetting, "pay_from_account_id")
        if s and s.value:
            try:
                account_id = int(s.value)
            except (TypeError, ValueError):
                account_id = None
    saved = 0
    duplicates = 0
    auto_paid = 0
    for r in rows:
        fp = r.get("fingerprint")
        if not fp:
            continue
        if ImportedTransaction.query.filter_by(fingerprint=fp).first():
            duplicates += 1
            continue
        d = r.get("date")
        try:
            d_obj = date_cls.fromisoformat(d) if isinstance(d, str) else d
        except ValueError:
            continue
        tx = ImportedTransaction(
            date=d_obj,
            description=r.get("description"),
            amount=r.get("amount", 0),
            category=r.get("category"),
            type=r.get("type"),
            source_file=source_file,
            matched_bill_id=r.get("matched_bill_id"),
            fingerprint=fp,
            confirmed=True,
            account_id=account_id,
            balance_after=r.get("balance_after"),
        )
        db.session.add(tx)
        saved += 1
        if tx.matched_bill_id and r.get("mark_paid"):
            now = datetime.utcnow()
            month, year = now.month, now.year
            rec = PaymentRecord.query.filter_by(bill_id=tx.matched_bill_id, month=month, year=year).first()
            if not rec:
                rec = PaymentRecord(bill_id=tx.matched_bill_id, month=month, year=year)
                db.session.add(rec)
            rec.amount_paid = abs(float(tx.amount or 0))
            rec.paid = True
            rec.paid_date = now
            auto_paid += 1
    db.session.commit()
    return jsonify(saved=saved, duplicates=duplicates, auto_paid=auto_paid)


def _end_of_day(rows):
    """The transaction holding a day's *closing* balance.

    Statement exports don't agree on row order — Chase lists newest first, so
    "highest id" is the day's oldest line and its balance is stale by every
    later transaction. Rather than assume an order, chain the rows: each line's
    balance minus its own amount is the balance that preceded it, so the
    closing balance is the one that never appears as somebody's predecessor.

    Falls back to the last row by id when the arithmetic is ambiguous (a
    duplicated balance, or a day whose lines didn't all import)."""
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    cents = lambda v: round(float(v or 0) * 100)
    preceding = {cents(r.balance_after) - cents(r.amount) for r in rows}
    terminal = [r for r in rows if cents(r.balance_after) not in preceding]
    if len(terminal) == 1:
        return terminal[0]
    return max(rows, key=lambda r: r.id)


@bp.get("/reconcile")
@require_auth
def reconcile():
    """Check an account's Hearth balance against the bank's own last figure.

    The statement prints a running balance after each line — that number is the
    bank's truth at that moment. Anything Hearth has recorded since then
    (payments marked paid, which deduct) should account for the difference. Cash
    that neither the statement nor a recorded payment explains is drift, and
    drift is exactly what silently accumulates in a hand-maintained balance.
    """
    account_id = request.args.get("account_id", type=int)
    if account_id is None:
        s = db.session.get(AppSetting, "pay_from_account_id")
        if s and s.value:
            try:
                account_id = int(s.value)
            except (TypeError, ValueError):
                account_id = None
    if account_id is None:
        return jsonify(error="no_account", message="Pick an account to reconcile."), 400
    account = db.session.get(SavingsAccount, account_id)
    if account is None:
        return jsonify(error="account_not_found"), 404

    latest = (db.session.query(func.max(ImportedTransaction.date))
              .filter(ImportedTransaction.account_id == account_id,
                      ImportedTransaction.balance_after.isnot(None)).scalar())
    same_day = []
    if latest is not None:
        same_day = (ImportedTransaction.query
                    .filter(ImportedTransaction.account_id == account_id,
                            ImportedTransaction.date == latest,
                            ImportedTransaction.balance_after.isnot(None))
                    .all())
    anchor = _end_of_day(same_day)
    if anchor is None:
        return jsonify({
            "account": {"id": account.id, "name": account.name,
                        "balance": float(account.balance or 0)},
            "status": "no_anchor",
            "message": ("No imported statement for this account carries a running balance, "
                        "so there's nothing to reconcile against yet."),
        })

    statement_balance = float(anchor.balance_after or 0)
    as_of = anchor.date
    hearth_balance = float(account.balance or 0)

    # Payments recorded as paid *after* the statement date, which deducted from
    # this account. Those legitimately explain a lower Hearth balance.
    deductions = []
    since = (PaymentRecord.query
             .filter(PaymentRecord.paid == True,
                     PaymentRecord.deducted_amount.isnot(None),
                     PaymentRecord.deducted_amount != 0)
             .all())
    bills = {b.id: b for b in Bill.query.all()}
    deducted_total = 0.0
    for p in since:
        if p.paid_date is None or p.paid_date.date() <= as_of:
            continue
        amt = float(p.deducted_amount or 0)
        if not amt:
            continue
        deducted_total += amt
        bill = bills.get(p.bill_id)
        deductions.append({
            "bill": bill.name.strip() if bill and bill.name else f"Bill {p.bill_id}",
            "amount": round(amt, 2),
            "paid_date": p.paid_date.date().isoformat(),
        })
    deductions.sort(key=lambda d: -d["amount"])

    expected = round(statement_balance - deducted_total, 2)
    drift = round(hearth_balance - expected, 2)

    return jsonify({
        "account": {"id": account.id, "name": account.name, "balance": round(hearth_balance, 2)},
        "status": "ok",
        "as_of": as_of.isoformat(),
        "source_file": anchor.source_file,
        "statement_balance": round(statement_balance, 2),
        "deducted_since": round(deducted_total, 2),
        "deductions": deductions,
        "expected_balance": expected,
        "drift": drift,
        # A dollar of rounding isn't worth a warning; anything more is real.
        "reconciled": abs(drift) <= 1.00,
    })


@bp.get("/transactions")
@require_auth
def list_transactions():
    """List imported transactions, newest first. Optional filters:
    ?category= (use "Uncategorized" for blanks), ?start=&end= (YYYY-MM-DD) or
    ?months=N for a trailing window, ?limit= (default 200)."""
    q = ImportedTransaction.query

    cat = request.args.get("category")
    if cat is not None:
        if cat in ("Uncategorized", ""):
            q = q.filter((ImportedTransaction.category.is_(None)) | (ImportedTransaction.category == ""))
        else:
            q = q.filter(ImportedTransaction.category == cat)

    def _d(s):
        try:
            return date_cls.fromisoformat(s) if s else None
        except ValueError:
            return None
    start = _d(request.args.get("start"))
    end = _d(request.args.get("end"))
    months = request.args.get("months", type=int)
    if months and not start:
        today = date_cls.today()
        tm = today.year * 12 + (today.month - 1) - (months - 1)
        start = date_cls(tm // 12, tm % 12 + 1, 1)
    if start:
        q = q.filter(ImportedTransaction.date >= start)
    if end:
        q = q.filter(ImportedTransaction.date <= end)

    limit = request.args.get("limit", default=200, type=int)
    merchant = request.args.get("merchant")  # exact merchant_key match (Python-side)
    q = q.order_by(ImportedTransaction.date.desc())
    # When filtering by merchant we must scan + match in Python (merchant_key is
    # computed), so skip the SQL limit and truncate after matching instead.
    if limit and not merchant:
        q = q.limit(limit)
    out = []
    for r in q.all():
        mk = cat_svc.merchant_key(r.description)
        if merchant and mk != merchant:
            continue
        d = r.to_dict()
        d["merchant"] = mk
        d["suggest"] = cat_svc.suggest_keyword(r.description)
        out.append(d)
        if merchant and limit and len(out) >= limit:
            break
    return jsonify(out)


@bp.post("/transactions/bulk-categorize")
@require_auth
def bulk_categorize():
    """Set the category on many transactions at once (used by the drill-down's
    'set all to…' action). Body: {ids: [int], category: str}."""
    data = request.get_json(silent=True) or {}
    ids = [int(i) for i in (data.get("ids") or [])]
    category = (data.get("category") or "").strip() or None
    if not ids:
        return jsonify(error="no_ids"), 400
    n = (ImportedTransaction.query.filter(ImportedTransaction.id.in_(ids))
         .update({"category": category}, synchronize_session=False))
    db.session.commit()
    return jsonify(updated=n)


@bp.put("/transactions/<int:tx_id>")
@require_auth
def update_transaction(tx_id):
    """Edit a saved transaction: its category, and/or the bill it's matched to.

    For `matched_bill_id`, pass `apply_merchant: true` to link every transaction
    from the SAME merchant to that bill (so the whole recurring series updates,
    not just this row). Pass matched_bill_id null to unassign.
    """
    tx = db.session.get(ImportedTransaction, tx_id)
    if not tx:
        return jsonify(error="not_found"), 404
    data = request.get_json(silent=True) or {}
    extra = {}
    if "category" in data:
        tx.category = (data.get("category") or "").strip() or None
    if "matched_bill_id" in data:
        raw = data.get("matched_bill_id")
        bid = int(raw) if raw not in (None, "", 0, "0") else None
        tx.matched_bill_id = bid
        linked = 1
        key = cat_svc.merchant_key(tx.description) if tx.description else ""
        # Guard: a vague key ("Pos Debit", "Payment") would sweep up unrelated
        # transactions — in that case only this row is changed.
        if data.get("apply_merchant") and key and not cat_svc.is_generic_merchant_key(key):
            for other in ImportedTransaction.query.filter(ImportedTransaction.id != tx.id).all():
                if cat_svc.merchant_key(other.description) == key:
                    other.matched_bill_id = bid
                    linked += 1
        extra = {"linked": linked, "merchant": key or None}
    db.session.commit()
    return jsonify({**tx.to_dict(), **extra})


@bp.delete("/transactions/<int:tx_id>")
@require_auth
def delete_transaction(tx_id):
    tx = db.session.get(ImportedTransaction, tx_id)
    if not tx:
        return jsonify(error="not_found"), 404
    db.session.delete(tx)
    db.session.commit()
    return jsonify(deleted=1)


@bp.post("/transactions/delete")
@require_auth
def delete_transactions():
    """Bulk-delete imported transactions by explicit ids and/or an inclusive
    date range. Body: {ids?: [int], start?: 'YYYY-MM-DD', end?: 'YYYY-MM-DD'}.

    `ids` and the date range are combined with OR (a row matching either is
    removed). At least one criterion is required — we never wipe everything by
    accident. Deleting a transaction does not touch any PaymentRecord that an
    earlier import may have created.
    """
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") or []
    start = body.get("start")
    end = body.get("end")

    conds = []
    if ids:
        conds.append(ImportedTransaction.id.in_([int(i) for i in ids]))

    range_parts = []
    if start:
        try:
            range_parts.append(ImportedTransaction.date >= date_cls.fromisoformat(start))
        except ValueError:
            return jsonify(error="bad_start", message="start must be YYYY-MM-DD"), 400
    if end:
        try:
            range_parts.append(ImportedTransaction.date <= date_cls.fromisoformat(end))
        except ValueError:
            return jsonify(error="bad_end", message="end must be YYYY-MM-DD"), 400
    if range_parts:
        conds.append(and_(*range_parts))

    if not conds:
        return jsonify(error="no_criteria",
                       message="Provide ids and/or a start/end date range."), 400

    n = ImportedTransaction.query.filter(or_(*conds)).delete(synchronize_session=False)
    db.session.commit()
    return jsonify(deleted=n)
