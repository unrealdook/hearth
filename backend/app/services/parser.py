"""Bank statement parsing — CSV (Chase format primary) and PDF."""
from __future__ import annotations
import csv
import hashlib
import io
import re
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from typing import Iterable


CHASE_DATE_KEYS = ["Posting Date", "Transaction Date", "Date"]
CHASE_AMOUNT_KEYS = ["Amount", "Debit", "Credit"]
CHASE_DESC_KEYS = ["Description", "Memo", "Details"]
CHASE_BALANCE_KEYS = ["Balance", "Running Balance", "Running Bal."]


def _first(row: dict, keys: list[str]) -> str | None:
    for k in keys:
        if k in row and row[k] not in ("", None):
            return row[k]
    return None


def _parse_date(value: str):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(value: str):
    if value is None:
        return None
    s = value.replace(",", "").replace("$", "").strip()
    s = s.replace("(", "-").replace(")", "")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _fingerprint(date_str: str, desc: str, amount: str, occurrence: int = 0) -> str:
    """Stable dedupe key for a transaction.

    `occurrence` disambiguates rows that are otherwise identical within a single
    statement (same date, description and amount) — e.g. two separate $20 charges
    to the same merchant on the same day. The first occurrence keeps the legacy
    (suffix-free) key so it still dedupes against transactions imported before
    this change; only the 2nd, 3rd, … get a suffix so they aren't dropped as
    false duplicates. Re-importing the same file reproduces the same occurrence
    order, so genuine re-imports still dedupe correctly.
    """
    raw = f"{date_str}|{(desc or '').strip().lower()}|{amount}"
    if occurrence:
        raw += f"|{occurrence}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _occurrence(counts: dict, date_str: str, desc: str, amount: str) -> int:
    """Return how many identical (date, desc, amount) rows preceded this one in
    the current file, then record this one. Mutates `counts`."""
    key = (date_str, (desc or "").strip().lower(), amount)
    n = counts.get(key, 0)
    counts[key] = n + 1
    return n


def parse_csv(raw_bytes: bytes) -> list[dict]:
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    counts: dict = {}
    for r in reader:
        date_raw = _first(r, CHASE_DATE_KEYS) or ""
        date = _parse_date(date_raw)
        if date is None:
            continue
        desc = (_first(r, CHASE_DESC_KEYS) or "").strip()
        amt_raw = _first(r, CHASE_AMOUNT_KEYS) or ""
        amount = _parse_amount(amt_raw)
        if amount is None:
            continue
        ttype = "credit" if amount >= 0 else "debit"
        date_iso, amt_str = date.isoformat(), str(amount)
        occ = _occurrence(counts, date_iso, desc, amt_str)
        # The bank's own running balance after this line, when the export
        # carries one. It's the only figure in the file the bank guarantees,
        # which makes it the anchor for reconciling an account.
        balance = _parse_amount(_first(r, CHASE_BALANCE_KEYS) or "")
        rows.append({
            "date": date_iso,
            "description": desc,
            "amount": float(amount),
            "type": ttype,
            "balance_after": float(balance) if balance is not None else None,
            "fingerprint": _fingerprint(date_iso, desc, amt_str, occ),
        })
    return rows


def _statement_ref_date(text: str) -> date:
    """Anchor for resolving year-less dates: the latest full (year-bearing) date
    printed in the statement — typically the closing date — capped at today so a
    stray future date can't pull the anchor forward. Falls back to today when the
    statement prints no full dates at all."""
    today = datetime.now().date()
    best: date | None = None
    for tok in re.findall(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", text):
        d = _parse_date(tok)
        if d and d <= today and (best is None or d > best):
            best = d
    return best or today


def _resolve_yearless(token: str, ref_date: date):
    """Assign a year to an 'M/D' token (no year in the statement line) so it lands
    on the most recent date on or before the statement reference date. This both
    avoids future-dating (the old bug stamped the *current* year onto everything)
    and correctly straddles a Dec->Jan statement period."""
    try:
        month, day = (int(x) for x in token.split("/")[:2])
    except ValueError:
        return None
    for year in (ref_date.year, ref_date.year - 1):
        try:
            cand = date(year, month, day)
        except ValueError:
            continue  # e.g. 02/29 in a non-leap year
        if cand <= ref_date:
            return cand
    return None


def parse_pdf(raw_bytes: bytes) -> list[dict]:
    try:
        import pdfplumber  # imported lazily; large dependency
    except ImportError:
        return []
    rows: list[dict] = []
    counts: dict = {}
    with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]

    # Resolve the statement's year ONCE from the whole document, then apply it to
    # any transaction line that omits the year.
    ref_date = _statement_ref_date("\n".join(pages))

    for text in pages:
        for line in text.splitlines():
            # naive heuristic: date  description  amount
            m = re.match(r"^(\d{1,2}/\d{1,2}(?:/\d{2,4})?)\s+(.+?)\s+(-?\$?\(?\d[\d,]*\.\d{2}\)?)\s*$", line)
            if not m:
                continue
            d_obj = _parse_date(m.group(1)) or _resolve_yearless(m.group(1), ref_date)
            desc = m.group(2).strip()
            amount = _parse_amount(m.group(3))
            if d_obj is None or amount is None:
                continue
            ttype = "credit" if amount >= 0 else "debit"
            date_iso, amt_str = d_obj.isoformat(), str(amount)
            occ = _occurrence(counts, date_iso, desc, amt_str)
            rows.append({
                "date": date_iso,
                "description": desc,
                "amount": float(amount),
                "type": ttype,
                "fingerprint": _fingerprint(date_iso, desc, amt_str, occ),
            })
    return rows


def parse_statement(filename: str, raw_bytes: bytes) -> list[dict]:
    name = filename.lower()
    if name.endswith(".pdf"):
        return parse_pdf(raw_bytes)
    return parse_csv(raw_bytes)
