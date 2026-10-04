"""Extract structured income data from an uploaded document (pay stub, bonus
statement, ACH/wire deposit confirmation) using the local Ollama LLM.

Stays fully local. We only extract + return data for the user to review — nothing
is saved here. Digital PDFs (with a text layer) and plain text work; scanned
image-only PDFs have no extractable text and aren't supported (no OCR).
"""
from __future__ import annotations
import io
import json
import re

from . import ollama_client


# Numeric fields we coerce to float-or-None after the model responds.
NUMERIC_FIELDS = (
    "gross", "net", "federal_tax", "state_tax", "fica",
    "retirement_401k", "health", "other", "amount",
)
DOC_TYPES = {"paycheck", "bonus", "one_off"}
FREQUENCIES = {"monthly", "biweekly", "semimonthly", "weekly", "annual"}


def _usable(text: str) -> str:
    """Return cleaned text only if it actually contains readable words. PDFs with
    subsetted fonts and no ToUnicode map extract as '(cid:N)' placeholders / null
    bytes — lots of characters, but no real content. We treat those as empty so
    the caller can tell the user plainly instead of feeding the LLM garbage."""
    if not text:
        return ""
    # '(cid:N)' placeholders mean the font had no Unicode map — the text is
    # undecodable. Real extractable docs have ~zero of these.
    if text.count("(cid:") >= 16:
        return ""
    cleaned = re.sub(r"\(cid:\d+\)", "", text)
    cleaned = "".join(ch for ch in cleaned if ch.isprintable() or ch in "\n\t ")
    # Needs a reasonable amount of real letters AND some digits — a pay stub or
    # statement is full of both; font-garbage tends to lack one or the other.
    alpha = sum(ch.isalpha() for ch in cleaned)
    digits = sum(ch.isdigit() for ch in cleaned)
    if alpha < 40 or digits < 5:
        return ""
    return cleaned.strip()


def _pdf_text(raw_bytes: bytes) -> str:
    """Extract PDF text, trying pdfplumber first then PyMuPDF (fitz). PyMuPDF's
    font engine reads many statements (ADP pay stubs, etc.) that pdfplumber
    returns as '(cid:N)' garbage. Whichever yields usable text wins."""
    try:
        import pdfplumber  # lazy: large dependency
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        usable = _usable(text)
        if usable:
            return usable
    except Exception:
        pass
    # fallback: PyMuPDF handles tricky/subsetted fonts pdfplumber can't.
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=raw_bytes, filetype="pdf")
        return _usable("\n".join(page.get_text() for page in doc))
    except Exception:
        return ""


def extract_text(filename: str, raw_bytes: bytes) -> str:
    """Pull text from a PDF (digital) or decode a text file. Returns '' if there's
    nothing usable (scanned image, or font-encoded PDF with no text layer)."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return _pdf_text(raw_bytes)
    # txt/csv/anything else: best-effort decode
    try:
        return _usable(raw_bytes.decode("utf-8-sig", errors="replace"))
    except Exception:
        return ""


SYSTEM_PROMPT = (
    "You extract structured data from a single income document — a pay stub, a "
    "bonus/commission statement, or a deposit/ACH/wire confirmation. "
    "Respond with ONLY a JSON object. No prose, no markdown, no code fences.\n\n"
    "Fields:\n"
    '- "doc_type": "paycheck" for regular recurring wages, "bonus" for a '
    'bonus/commission, "one_off" for an ACH/wire/deposit or other single payment.\n'
    '- "employer": payer or employer name, or null.\n'
    '- "pay_date": date paid in YYYY-MM-DD, or null.\n'
    '- "period_start", "period_end": pay period dates YYYY-MM-DD, or null.\n'
    '- "frequency": one of monthly, biweekly, semimonthly, weekly, annual — only '
    "for a paycheck, else null.\n"
    '- "gross", "net": per-paycheck dollar amounts as numbers, or null.\n'
    '- "federal_tax", "state_tax", "fica", "retirement_401k", "health", "other": '
    "per-paycheck deduction amounts as numbers, or null. These are SUMS — a stub "
    "often splits one category across several lines:\n"
    "  * fica = Social Security + Medicare added together (e.g. 'SOC SEC EE' + 'MED EE').\n"
    "  * state_tax = ALL state, county, and local income tax withholdings added "
    "together (e.g. a state WH line plus a county/city line).\n"
    "  * health = medical + dental + vision employee deductions added together.\n"
    "  * retirement_401k = 401k/403b/457 employee contributions.\n"
    "  * other = everything else deducted from pay: HSA/FSA, life or disability "
    "insurance premiums, garnishments, union dues.\n"
    "IGNORE employer-paid lines — anything marked ER, employer, imputed/GTL, or "
    "flagged 'not included in totals' (often with a * marker). Those are not "
    "deducted from the employee's pay.\n"
    '- "amount": for bonus or one_off, the single payment amount as a number, or null.\n'
    '- "description": a short note such as "Q1 bonus" or "ACH from Acme LLC", or null.\n\n'
    "Numbers must have no currency symbols or commas. Use null for anything absent. "
    "Do not guess values that are not present in the document.\n\n"
    "Important for pay stubs: use the CURRENT pay-period amounts, never the "
    "year-to-date (YTD) totals (YTD numbers are much larger). Amounts may be "
    "printed with spaces instead of commas/decimals, e.g. '4 543 62' means "
    "4543.62 and '1 234 56' means 1234.56. All deduction amounts should be "
    "positive numbers.\n\n"
    "Frequency: biweekly means every 14 days (26 checks/year, salaried stubs "
    "often show 80.00 hours). Semimonthly means twice a month (24 checks/year, "
    "often paid the 15th and last day, salaried stubs often show 86.67 hours). "
    "A 14-day period with a mid-month check date is usually semimonthly.\n\n"
    "Check your work: gross minus all taxes and deductions must equal net. If it "
    "does not, re-read the stub — you likely missed a line or picked a YTD value."
)

# Cap how much text we hand the model — stubs are short; this guards against a
# giant multi-page PDF blowing the context window.
MAX_CHARS = 8000


class ExtractError(RuntimeError):
    pass


def _coerce_number(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(re.sub(r"[,$\s]", "", str(v)).replace("(", "-").replace(")", ""))
    except (TypeError, ValueError):
        return None


def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of the model's reply, tolerant of stray
    prose or code fences."""
    # strip code fences if present
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        start = text.find("{")
        end = text.rfind("}")
        candidate = text[start:end + 1] if (start != -1 and end > start) else None
    if not candidate:
        raise ExtractError("Model did not return JSON.")
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as e:
        raise ExtractError(f"Could not parse model JSON: {e}") from e


def parse_income_document(text: str, base_url: str, model: str) -> dict:
    """Run the document text through Ollama and return a normalized dict."""
    snippet = text[:MAX_CHARS]
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": snippet},
    ]
    # format="json" forces the model to return a valid JSON object.
    reply = ollama_client.chat(base_url, model, messages, fmt="json")
    data = _extract_json(reply)

    doc_type = str(data.get("doc_type") or "").strip().lower()
    if doc_type not in DOC_TYPES:
        doc_type = "paycheck"  # safest default; user can change it
    freq = str(data.get("frequency") or "").strip().lower()
    if freq not in FREQUENCIES:
        freq = None

    out = {
        "doc_type": doc_type,
        "employer": (data.get("employer") or None),
        "pay_date": (data.get("pay_date") or None),
        "period_start": (data.get("period_start") or None),
        "period_end": (data.get("period_end") or None),
        "frequency": freq,
        "description": (data.get("description") or None),
    }
    for f in NUMERIC_FIELDS:
        out[f] = _coerce_number(data.get(f))

    # --- sanity guards -------------------------------------------------------
    # Stubs are notoriously misread (YTD totals grabbed instead of the current
    # column, decimals dropped). Rather than pre-fill nonsense, drop impossible
    # values and flag low confidence so the UI can warn the user.
    DED = ("federal_tax", "state_tax", "fica", "retirement_401k", "health", "other")
    g = out["gross"]
    for f in DED:
        v = out[f]
        if v is None:
            continue
        v = abs(v)                       # deductions are positive
        # a single per-check deduction can't exceed gross — that's a YTD mis-read
        out[f] = None if (g and v > g) else v
    if out["net"] is not None and out["net"] < 0:
        out["net"] = None                # take-home can't be negative
    if out["amount"] is not None and out["amount"] < 0:
        out["amount"] = None

    ded = sum(out[f] or 0 for f in DED)
    if out["net"] is None and g is not None and ded > 0:
        out["net"] = round(g - ded, 2)

    # confidence: gross - deductions should land near net. On a real stub the
    # identity holds to the penny, so anything past rounding noise means a line
    # was missed or misfiled (a 6% band let a ~$230 miss through unflagged).
    low = False
    if g is not None and out["net"] is not None and abs(g - ded - out["net"]) > max(0.01 * abs(g), 25):
        low = True
    if g is not None and ded > g:
        low = True
    if out["net"] is None and out["amount"] is None:
        low = True   # nothing usable came back
    out["low_confidence"] = low
    return out
