"""Encrypted full-database backup/restore + a CSV export for your accountant."""
import csv
import io
import os
import shutil
import zipfile
from datetime import datetime
from cryptography.fernet import Fernet, InvalidToken
from flask import Blueprint, request, jsonify, current_app, Response
from sqlalchemy import text
from ..models import (db, Income, IncomeEvent, Bill, PaymentRecord, ImportedTransaction,
                      GiveEvent, Debt, SavingsAccount, InvestmentAccount, Retirement401k,
                      UtilityReading, FicoEntry, AnnualIncome, Project, WorkEntry,
                      NetWorthSnapshot)
from ._helpers import require_auth, get_session_key

bp = Blueprint("backup", __name__, url_prefix="/api")

SQLITE_MAGIC = b"SQLite format 3\x00"


def _db_path():
    uri = current_app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if uri.startswith("sqlite:///"):
        return uri[len("sqlite:///"):]
    return None


@bp.get("/backup")
@require_auth
def backup():
    """Download the whole database, encrypted with your passcode-derived key."""
    path = _db_path()
    if not path or not os.path.exists(path):
        return jsonify(error="no_db"), 500
    try:
        db.session.execute(text("PRAGMA wal_checkpoint(FULL)"))
        db.session.commit()
    except Exception:
        db.session.rollback()
    with open(path, "rb") as fh:
        raw = fh.read()
    key = get_session_key()
    blob = Fernet(key.encode("ascii")).encrypt(raw)
    fname = f"hearth-backup-{datetime.utcnow():%Y%m%d-%H%M}.hbk"
    return Response(blob, mimetype="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@bp.post("/backup/restore")
@require_auth
def restore():
    """Replace the database from an encrypted backup. Requires a restart after."""
    f = request.files.get("file")
    if not f:
        return jsonify(error="no_file"), 400
    blob = f.read()
    key = get_session_key()
    try:
        data = Fernet(key.encode("ascii")).decrypt(blob)
    except InvalidToken:
        return jsonify(error="bad_key",
                       message="Couldn't decrypt — this backup was made with a different passcode."), 400
    if not data.startswith(SQLITE_MAGIC):
        return jsonify(error="not_sqlite", message="That doesn't look like a Hearth backup."), 400

    path = _db_path()
    if not path:
        return jsonify(error="no_db"), 500
    # release file handles so we can overwrite, and keep a safety copy
    db.session.close()
    db.engine.dispose()
    try:
        if os.path.exists(path):
            shutil.copyfile(path, path + ".pre-restore")
        with open(path, "wb") as fh:
            fh.write(data)
    except OSError as e:
        return jsonify(error="write_failed",
                       message=f"Couldn't write the database (it may be locked): {e}. "
                               f"Close the app and replace finance.db manually."), 500
    return jsonify(ok=True, restart_required=True)


# CSV export ------------------------------------------------------------------
_EXPORT = [
    ("income.csv", Income), ("income_events.csv", IncomeEvent), ("bills.csv", Bill),
    ("payments.csv", PaymentRecord), ("transactions.csv", ImportedTransaction),
    ("giving.csv", GiveEvent), ("debt.csv", Debt), ("savings.csv", SavingsAccount),
    ("investments.csv", InvestmentAccount), ("retirement.csv", Retirement401k),
    ("utilities.csv", UtilityReading), ("fico.csv", FicoEntry),
    ("annual_income.csv", AnnualIncome), ("projects.csv", Project),
    ("work_entries.csv", WorkEntry), ("networth_snapshots.csv", NetWorthSnapshot),
]


@bp.get("/export")
@require_auth
def export_csv():
    """A zip of CSVs for every table (credentials are never included)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, model in _EXPORT:
            rows = model.query.all()
            dicts = [r.to_dict() for r in rows]
            s = io.StringIO()
            if dicts:
                keys = list(dicts[0].keys())
                w = csv.DictWriter(s, fieldnames=keys, extrasaction="ignore")
                w.writeheader()
                for d in dicts:
                    w.writerow({k: d.get(k) for k in keys})
            z.writestr(name, s.getvalue())
    fname = f"hearth-export-{datetime.utcnow():%Y%m%d}.zip"
    return Response(buf.getvalue(), mimetype="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})
