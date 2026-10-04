"""Parse a pay stub PDF into a structured paycheck.

Deterministic and local — no LLM. A wrong number here silently corrupts income
history, so we'd rather return nothing and make the user type it than return a
plausible guess.

Why geometry instead of text: a stub prints EARNINGS, TAXES and DEDUCTIONS as
three side-by-side tables. `extract_text` flattens them into lines like

    Salary 76.9202 86.67 6,666.67 173.34 13,333.34 SOC SEC EE 688.30 1,066.61 Dental PreTax 72.51 145.02

where a number's meaning is genuinely ambiguous. Word x-positions recover the
columns exactly, so we read each table on its own. Every figure is x-aligned to
its own column header rather than counted by position, which keeps it working
when a row omits a cell (a bonus line has no rate or hours).

Everything parsed is returned for review, never saved directly, and the
gross/withholding/net reconciliation is reported so a misread is visible.
"""
from __future__ import annotations

import hashlib
import io
import re
from datetime import datetime

ROW_TOL = 3.0        # points; words within this vertical distance share a row
COL_TOL = 30.0       # points; how far a value may sit from its column anchor

MONEY_RE = re.compile(r"^[-+(]?\$?[\d,]+\.\d{2}\)?$")
DATE_PAT = r"(\d{1,2}/\d{1,2}/\d{2,4})"

FEDERAL_HINTS = ("federal", "fed wh", "fed w/h")
FICA_HINTS = ("soc sec", "social security", "oasdi", "med ee", "medicare", "fica")
RETIREMENT_HINTS = ("401k", "401(k)", "403b", "roth", "retirement")
HEALTH_HINTS = ("medical", "dental", "vision", "health")


def _num(raw):
    if raw is None:
        return None
    s = str(raw).replace("$", "").replace(",", "").strip()
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if s in ("", "-"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _date(raw):
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _is_money(word: str) -> bool:
    return bool(MONEY_RE.match(word or ""))


def _rows(words):
    """Group words into visual rows, each sorted left to right."""
    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda x: (x["top"], x["x0"])):
        if rows and abs(rows[-1][0]["top"] - w["top"]) <= ROW_TOL:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda x: x["x0"]) for r in rows]


def _nums(words):
    """[(x_centre, value)] for the money-looking words in a row."""
    out = []
    for w in words:
        if _is_money(w["text"]):
            v = _num(w["text"])
            if v is not None:
                out.append(((w["x0"] + w["x1"]) / 2.0, v))
    return out


def _label(words) -> str:
    return " ".join(w["text"] for w in words if not _is_money(w["text"])).strip()


def _nearest(nums, x, tol=COL_TOL):
    """The value whose column sits closest to `x`, or None if nothing is near."""
    best, best_d = None, tol
    for cx, v in nums:
        d = abs(cx - x)
        if d < best_d:
            best, best_d = v, d
    return best


def _anchor(row, *texts):
    """x-centre of the first word in `row` matching any of `texts`."""
    for w in row:
        t = w["text"].strip().lower().rstrip(":")
        if t in texts:
            return (w["x0"] + w["x1"]) / 2.0
    return None


def extract_text(filename: str, raw: bytes) -> str:
    if (filename or "").lower().endswith(".pdf"):
        import pdfplumber
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)
    return raw.decode("utf-8", errors="replace")


def _band_starts(rows):
    """Left edge of each of the three tables.

    Anchored on the row that repeats 'Description' once per table — the only
    marker that reliably sits at each table's true left edge (the EARNINGS /
    TAXES / DEDUCTIONS banner above it is centred, not aligned)."""
    for row in rows:
        xs = [w["x0"] for w in row if w["text"].strip().lower().rstrip(":") == "description"]
        if len(xs) >= 3:
            return sorted(xs)[:3]
    return None


def _banded(rows, starts):
    """Split rows into (earnings, taxes, deductions) cells.

    Also repairs wrapped rows: a stub may print 'FEDERAL WH' on the line below
    its own figures, leaving one cell with numbers and no label and the next
    with a label and no numbers. Those two halves are the same entry."""
    e0, t0, d0 = starts
    out = []
    for row in rows:
        cells = {"earnings": [], "taxes": [], "deductions": []}
        for w in row:
            x = w["x0"]
            if x >= d0 - 4:
                cells["deductions"].append(w)
            elif x >= t0 - 4:
                cells["taxes"].append(w)
            elif x >= e0 - 4:
                cells["earnings"].append(w)
        out.append(cells)

    for band in ("taxes", "deductions", "earnings"):
        for i, cells in enumerate(out):
            words = cells[band]
            if not words or _label(words):
                continue
            # numbers with no label — adopt the label from an adjacent
            # label-only cell in the same band
            for j in (i + 1, i - 1):
                if 0 <= j < len(out):
                    other = out[j][band]
                    if other and _label(other) and not _nums(other):
                        cells[band] = words + other
                        out[j][band] = []
                        break
    return out


def _entries(banded, band, current_x):
    """[(label, current_value)] for one table."""
    rows = []
    for cells in banded:
        words = cells[band]
        if not words:
            continue
        label = _label(words).strip()
        nums = _nums(words)
        if not label or not nums:
            continue
        value = _nearest(nums, current_x) if current_x is not None else nums[0][1]
        if value is None:
            continue
        rows.append((label, value))
    return rows


def parse(filename: str, raw: bytes) -> dict:
    text = extract_text(filename, raw)
    out: dict = {"ok": True, "warnings": [], "raw_text": text[:4000]}

    if not text.strip():
        return {"ok": False, "error": "no_text",
                "message": "No text layer in that PDF — it may be a scan. Enter the check manually."}

    # --- dates (regex over flattened text is fine; labels are unambiguous) ---
    def find_date(*labels):
        for label in labels:
            m = re.search(re.escape(label) + r"\D{0,14}" + DATE_PAT, text, re.I)
            if m:
                return _date(m.group(1))
        return None

    # ISO strings, not date objects: this dict is returned straight to the
    # client and posted back verbatim to save, and jsonify renders a date as
    # RFC-822 ("Fri, 31 Jul 2026 …"), which won't parse on the way back in.
    def iso(d):
        return d.isoformat() if d else None

    out["check_date"] = iso(find_date("check date", "pay date", "payment date"))
    out["period_start"] = iso(find_date("period begin", "period start"))
    out["period_end"] = iso(find_date("period end"))

    if not (filename or "").lower().endswith(".pdf"):
        out["warnings"].append("Only PDF stubs are parsed in full; enter the figures manually.")
        return out

    import pdfplumber
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        page = pdf.pages[0]
        rows = _rows(page.extract_words())

    # --- gross / net: x-aligned to their own headers ------------------------
    for i, row in enumerate(rows):
        gx = _anchor(row, "gross")
        nx = _anchor(row, "net")
        if gx is None or nx is None or i + 1 >= len(rows):
            continue
        nums = _nums(rows[i + 1])
        if len(nums) < 2:
            continue
        out["gross"] = _nearest(nums, gx)
        out["net"] = _nearest(nums, nx)
        break
    out.setdefault("gross", None)
    out.setdefault("net", None)
    if out["net"] is None:
        m = re.search(r"total net pay\s*\**\$?([\d,]+\.\d{2})", text, re.I)
        if m:
            out["net"] = _num(m.group(1))

    starts = _band_starts(rows)
    if not starts:
        out["warnings"].append(
            "Couldn't find the earnings/taxes/deductions columns — only totals were read.")
        _check_math(out)
        out["employer"] = _employer(rows)
        return out

    banded = _banded(rows, starts)

    # "Current" column anchors, so we never grab the YTD figure beside it.
    cur_tax_x = cur_ded_x = None
    for cells in banded:
        if cur_tax_x is None:
            cur_tax_x = _anchor(cells["taxes"], "current")
        if cur_ded_x is None:
            cur_ded_x = _anchor(cells["deductions"], "current")

    # --- taxes ---------------------------------------------------------------
    federal = state = fica = None
    tax_total = None
    for label, value in _entries(banded, "taxes", cur_tax_x):
        low = label.lower()
        if low.startswith("total"):
            tax_total = value
            continue
        if any(h in low for h in FEDERAL_HINTS):
            federal = (federal or 0) + value
        elif any(h in low for h in FICA_HINTS):
            fica = (fica or 0) + value
        else:
            # whatever is left is state / county / city withholding
            state = (state or 0) + value
    out["federal_tax"] = round(federal, 2) if federal is not None else None
    out["fica"] = round(fica, 2) if fica is not None else None
    out["state_tax"] = round(state, 2) if state is not None else None

    # --- deductions ----------------------------------------------------------
    health = retirement = None
    ded_total = None
    other = 0.0
    for label, value in _entries(banded, "deductions", cur_ded_x):
        low = label.lower()
        if low.startswith("total"):
            ded_total = value
            continue
        if any(h in low for h in RETIREMENT_HINTS):
            retirement = (retirement or 0) + value
        elif any(h in low for h in HEALTH_HINTS):
            health = (health or 0) + value
        else:
            other += value
    out["health_insurance"] = round(health, 2) if health is not None else None
    out["retirement_401k"] = round(retirement, 2) if retirement is not None else None
    out["other_deductions"] = round(other, 2) if other > 0.005 else None

    if ded_total is not None:
        booked = (health or 0) + (retirement or 0) + other
        if abs(booked - ded_total) > 0.01:
            out["warnings"].append(
                f"Deduction lines total ${booked:,.2f} but the stub says ${ded_total:,.2f}.")
    if tax_total is not None:
        booked = (federal or 0) + (fica or 0) + (state or 0)
        if abs(booked - tax_total) > 0.01:
            out["warnings"].append(
                f"Tax lines total ${booked:,.2f} but the stub says ${tax_total:,.2f}.")

    # --- earnings: bonus vs salary ------------------------------------------
    # The earnings table's own Total row identifies the current-dollars column:
    # it is the figure closest to gross. Anchoring there means a Bonus row with
    # no rate or hours still resolves to the right number.
    dollars_x = None
    if out["gross"]:
        for cells in banded:
            words = cells["earnings"]
            if not words or not _label(words).lower().startswith("total"):
                continue
            nums = _nums(words)
            if nums:
                dollars_x = min(nums, key=lambda t: abs(t[1] - out["gross"]))[0]
            break
    for cells in banded:
        words = cells["earnings"]
        if not words:
            continue
        low = _label(words).lower()
        nums = _nums(words)
        if not nums:
            continue
        # '*' marks employer-paid lines the stub excludes from totals.
        if low.startswith("*"):
            continue
        value = _nearest(nums, dollars_x) if dollars_x is not None else None
        if value is None:
            continue
        if low.startswith(("bonus", "incentive", "commission")):
            out["bonus_gross"] = round((out.get("bonus_gross") or 0) + value, 2)
        elif low.startswith(("salary", "regular", "reg ")):
            out["salary_gross"] = round((out.get("salary_gross") or 0) + value, 2)
    out.setdefault("bonus_gross", None)
    out.setdefault("salary_gross", None)

    out["employer"] = _employer(rows)
    _check_math(out)
    return out


def _employer(rows) -> str | None:
    """Employer name. The header repeats the employee's name, so prefer a later
    standalone line that looks like a company."""
    candidates = []
    for row in rows:
        line = " ".join(w["text"] for w in row).strip()
        m = re.search(r"\b([A-Z][A-Za-z&.,' -]{1,40}?(?:Inc|LLC|L\.L\.C|Corp|Company|Ltd)\.?)\b", line)
        if m:
            candidates.append(m.group(1).strip().strip(","))
    if not candidates:
        return None
    # The shortest match is the bare company name, not "Name Employer Inc".
    return min(candidates, key=len)


def _check_math(out: dict) -> None:
    """Reconcile gross - withheld against net and warn loudly on a mismatch."""
    gross, net = out.get("gross"), out.get("net")
    if gross is None or net is None:
        out["warnings"].append("Couldn't read both gross and net — check the figures before saving.")
        out["reconciles"] = False
        return
    withheld = sum(v or 0 for v in (
        out.get("federal_tax"), out.get("state_tax"), out.get("fica"),
        out.get("retirement_401k"), out.get("health_insurance"), out.get("other_deductions"),
    ))
    diff = round(gross - withheld - net, 2)
    out["reconciles"] = abs(diff) <= 1.00
    out["reconcile_diff"] = diff
    if not out["reconciles"]:
        out["warnings"].append(
            f"Gross minus withholdings is off from net by ${diff:,.2f} — "
            "a line may have been misread. Review before saving.")
    bonus, salary = out.get("bonus_gross"), out.get("salary_gross")
    if bonus and salary and gross and abs(bonus + salary - gross) > 1.00:
        out["warnings"].append(
            f"Salary plus bonus (${bonus + salary:,.2f}) doesn't match gross (${gross:,.2f}).")


def fingerprint(employer, check_date, net) -> str:
    raw = f"{(employer or '').strip().lower()}|{check_date}|{net}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
