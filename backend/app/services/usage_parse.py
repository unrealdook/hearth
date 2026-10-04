"""Parse utility usage files into monthly readings.

Supports three formats:
- CSV: one row per statement (type, period_end, usage, unit, cost).
- ESPI / Green Button XML: interval meter data (e.g. 30-min kWh readings) — summed
  into per-month totals.
- PDF: a "usage overview" year x month grid (e.g. CenterPoint's 24-month report).

Each parser returns (readings, meta). A reading is a dict shaped like the
UtilityReading payload: utility_type, period_start, period_end, usage, unit, cost.
"""
from __future__ import annotations
import csv
import io
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timezone


class ParseError(RuntimeError):
    pass


UTILITY_TYPES = {"electric", "water", "gas", "internet", "trash", "sewer", "phone", "other"}

SERVICE_TYPE_MAP = {
    "ELECTRIC": "electric", "ELECTRICITY": "electric", "ELEC": "electric",
    "GAS": "gas", "NATURAL_GAS": "gas", "NATURALGAS": "gas",
    "WATER": "water", "SEWER": "sewer",
}
UNIT_MAP = {
    "KWH": "kWh", "KW": "kW", "WH": "Wh", "CCF": "CCF", "CF": "CF",
    "THERM": "therm", "THERMS": "therm", "GAL": "gal", "GALLONS": "gal", "M3": "m³",
}
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"], start=1)}


def _last_day(y: int, m: int) -> int:
    return monthrange(y, m)[1]


def _month_reading(utype, y, m, usage, unit, cost=0.0):
    return {
        "utility_type": utype,
        "period_start": date(y, m, 1).isoformat(),
        "period_end": date(y, m, _last_day(y, m)).isoformat(),
        "usage": round(usage, 3) if usage is not None else None,
        "unit": unit,
        "cost": round(cost or 0, 2),
    }


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


def _parse_date(value):
    if not value:
        return None
    value = str(value).strip()
    for fmt in (
        "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%Y/%m/%d",
        "%d-%b-%y", "%d-%b-%Y", "%d %b %y", "%d %b %Y",   # 11-Jun-24, 11 Jun 2024
        "%b-%y", "%b-%Y", "%b %y", "%b %Y",               # Jun-24, Jun 2024
        "%m/%d", "%m-%d",
    ):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------- CSV
_CSV_ALIAS = {
    "type": "utility_type", "utility": "utility_type", "utility type": "utility_type",
    "start": "period_start", "period start": "period_start", "from": "period_start",
    "begin": "period_start",
    "end": "period_end", "period end": "period_end", "date": "period_end", "to": "period_end",
    "month": "period_end", "period": "period_end", "bill date": "period_end",
    "statement date": "period_end", "service date": "period_end", "read date": "period_end",
    "usage": "usage", "quantity": "usage", "qty": "usage", "consumption": "usage",
    "used": "usage", "reading": "usage",
    "unit": "unit", "units": "unit",
    "cost": "cost", "amount": "cost", "total": "cost", "charge": "cost", "price": "cost", "bill": "cost",
}


def _normalize_header(h: str) -> str:
    """Lowercase, drop any (parenthetical) units, collapse punctuation/space so
    'Usage (Therms)' -> 'usage' and 'Cost ($)' -> 'cost'."""
    s = (h or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)          # strip "(Therms)", "($)"
    s = re.sub(r"[^a-z0-9 ]", " ", s)       # drop stray punctuation
    return re.sub(r"\s+", " ", s).strip()


def _header_unit(h: str) -> str | None:
    """Pull a unit out of a header like 'Usage (Therms)' -> therm."""
    m = re.search(r"\(([^)]*)\)", h or "")
    if not m:
        return None
    raw = m.group(1).strip()
    if not raw or raw in ("$",):
        return None
    return UNIT_MAP.get(raw.upper().rstrip("S") + "S", UNIT_MAP.get(raw.upper(), raw))


def parse_csv(raw: bytes):
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ParseError("Could not read the file as UTF-8 text.")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ParseError("The CSV has no header row.")

    header_map = {h: _CSV_ALIAS.get(_normalize_header(h)) for h in reader.fieldnames}
    # Capture a unit embedded in the usage column header, e.g. "Usage (Therms)".
    header_unit = None
    for h in reader.fieldnames:
        if header_map.get(h) == "usage":
            header_unit = _header_unit(h)
            break

    readings = []
    for raw_row in reader:
        row = {}
        for h, val in raw_row.items():
            key = header_map.get(h)
            if key:
                row[key] = val
        pe = _parse_date(row.get("period_end"))
        if not pe:
            continue
        utype = (row.get("utility_type") or "").strip().lower() or None
        if utype and utype not in UTILITY_TYPES:
            utype = "other"
        readings.append({
            "utility_type": utype,
            "period_start": (_parse_date(row.get("period_start")).isoformat()
                             if _parse_date(row.get("period_start")) else None),
            "period_end": pe.isoformat(),
            "usage": _num(row.get("usage")),
            "unit": (row.get("unit") or header_unit or None),
            "cost": _num(row.get("cost")) or 0,
        })
    meta = {"format": "csv", "detected_type": None, "detected_unit": header_unit, "months": len(readings)}
    return readings, meta


# --------------------------------------------------------------------- ESPI XML
def parse_espi(raw: bytes):
    """Sum interval meter readings (Green Button / ESPI) into per-month totals."""
    import xml.etree.ElementTree as ET

    monthly = defaultdict(float)
    cur_unit = None
    cur_service = None
    saw_reading = False
    try:
        for _event, elem in ET.iterparse(io.BytesIO(raw), events=("end",)):
            tag = elem.tag.split("}")[-1]
            if tag == "unitOfMeasure":
                cur_unit = (elem.text or "").strip() or cur_unit
            elif tag == "serviceType":
                cur_service = (elem.text or "").strip() or cur_service
            elif tag == "IntervalReading":
                start = None
                value = None
                for child in elem.iter():
                    ctag = child.tag.split("}")[-1]
                    if ctag == "start" and start is None:
                        try:
                            start = int((child.text or "").strip())
                        except (TypeError, ValueError):
                            pass
                    elif ctag == "value":
                        value = _num(child.text)
                if start is not None and value is not None:
                    d = datetime.fromtimestamp(start, tz=timezone.utc)
                    monthly[(d.year, d.month)] += value
                    saw_reading = True
                elem.clear()
    except ET.ParseError as e:
        raise ParseError(f"Could not parse the XML: {e}")

    if not saw_reading:
        raise ParseError("No interval readings found in the XML.")

    unit = UNIT_MAP.get((cur_unit or "").upper(), (cur_unit or None))
    utype = SERVICE_TYPE_MAP.get((cur_service or "").upper(), "other")
    readings = [_month_reading(utype, y, m, v, unit) for (y, m), v in sorted(monthly.items())]
    meta = {"format": "espi_xml", "detected_type": utype, "detected_unit": unit, "months": len(readings)}
    return readings, meta


# --------------------------------------------------------------------- PDF grid
def parse_pdf_grid(raw: bytes):
    """Parse a 'usage overview' year x month grid PDF into monthly readings.
    No units or cost in this format, so utility_type/unit are left for the user."""
    try:
        import pdfplumber
    except ImportError:
        raise ParseError("PDF support isn't available (pdfplumber not installed).")

    text_parts = []
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        for page in pdf.pages:
            text_parts.append(page.extract_text() or "")
    lines = [ln.strip() for ln in "\n".join(text_parts).splitlines() if ln.strip()]

    current_months: list[int] = []
    readings = []
    for line in lines:
        toks = line.split()
        if not toks:
            continue
        # header row: "Year January February March April"
        if toks[0].lower() == "year":
            ms = [MONTHS[t.lower()] for t in toks[1:] if t.lower() in MONTHS]
            if ms:
                current_months = ms
            continue
        # data row: "2025 33 30 28 32"
        if re.fullmatch(r"\d{4}", toks[0]) and current_months:
            year = int(toks[0])
            nums = toks[1:1 + len(current_months)]
            for mi, nstr in zip(current_months, nums):
                val = _num(nstr)
                if val is not None and val > 0:  # 0 = no data for that month
                    readings.append(_month_reading(None, year, mi, val, None))
    if not readings:
        raise ParseError("Couldn't find a year/month usage grid in the PDF.")
    readings.sort(key=lambda r: r["period_end"])
    meta = {"format": "pdf_grid", "detected_type": None, "detected_unit": None, "months": len(readings)}
    return readings, meta


def parse_file(filename: str, raw: bytes):
    name = (filename or "").lower()
    if name.endswith(".xml"):
        return parse_espi(raw)
    if name.endswith(".pdf"):
        return parse_pdf_grid(raw)
    # default: CSV (also handles .txt)
    return parse_csv(raw)
