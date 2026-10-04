"""Spending categorization.

Three layers, highest precedence first:
  1. Learned merchant rules (what the user taught us) — substring match.
  2. Built-in keyword rules — a starter map of nationally-known US merchants.
  3. Sign fallback — positive = Income, negative = Other.

Among matches, a *learned* rule always beats a built-in one; within a tier the
longest matching keyword wins (so "kroger fuel" -> Fuel beats "kroger" ->
Groceries). Also provides merchant-name normalization used for the "top
merchants" breakdown and for suggesting a keyword when teaching a new rule.
"""
from __future__ import annotations
import re

# (name, color) — seeded into the SpendingCategory table on first use.
# "Bills" collapses recurring household bills (insurance, internet/phone,
# utilities, streaming). Software/dev subscriptions stay under "Subscriptions".
DEFAULT_CATEGORIES: list[tuple[str, str]] = [
    ("Groceries", "#4C8C5A"),
    ("Dining", "#E0A458"),
    ("Fuel", "#C45D5D"),
    ("Auto", "#8A6FB0"),
    ("Bills", "#5BA3C4"),
    ("Subscriptions", "#B07BAC"),
    ("Shopping", "#D98E73"),
    ("Hobbies", "#6FB0A0"),
    ("Kids & School", "#E5C45B"),
    ("Health & Fitness", "#C97FA0"),
    ("Travel", "#7FA9D9"),
    ("Entertainment", "#B59B5C"),
    ("Loans", "#B08A5B"),
    ("Giving", "#9CB45B"),
    ("Home", "#A2785B"),
    ("Fees", "#9AA0A6"),
    ("Transfer", "#8C9BB0"),
    ("Income", "#4CA37A"),
    ("Other", "#8A8F98"),
]

# Built-in keyword -> category. Substring, case-insensitive.
#
# Deliberately limited to merchants recognisable across the US. Anything tied to
# one town, school, club or provider belongs in a user's own learned rules, not
# in shipped source: it is useless to everyone else and it quietly discloses
# where the author lives and what their family does. Learned rules outrank these
# anyway, so teaching a local merchant is the intended path.
_BUILTIN_RULES: list[tuple[str, list[str]]] = [
    ("Fuel", ["kroger fuel", "fuel ctr", "getgo", "speedway", "marathon", "shell oil",
              "shell service", "chevron", "exxon", "mobil", "bp#", "circle k", "pilot ",
              "wawa", "7-eleven", "sunoco", "casey's", "murphy"]),
    ("Groceries", ["kroger", "whole foods", "trader joe", "publix", "costco", "aldi",
                   "safeway", "meijer", "instacart", "sam's club", "sams club",
                   "dollar tree", "dollar general"]),
    ("Dining", ["mcdonald", "burger king", "wendy", "pizza hut", "taco bell", "culver",
                "starbucks", "doordash", "dd *", "uber eats", "grubhub", "chipotle",
                "panera", "ihop", "first watch", "little caesar", "tst*", "tst ", "sq *",
                "pub", "grille", "coffee"]),
    # Bills = recurring household bills: utilities, internet/phone, insurance,
    # and consumer streaming (Netflix/Hulu/Spotify/Disney).
    ("Bills", ["centerpoint", "duke energy", "american water", "sewer", "water works",
               "comcast", "xfinity", "att*bill", "at&t", "verizon", "t-mobile",
               "tmobile", "spectrum", "frontier",
               "allstate", "geico", "progressive", "state farm",
               "netflix", "hulu", "spotify", "disney+", "roku", "youtube tv", "sling"]),
    # Subscriptions = software / digital / dev services (not household bills).
    ("Subscriptions", ["apple.com/bill", "google *workspace", "google *", "claude.ai",
                       "anthropic", "heroku", "kindle svcs", "squarespace", "sqsp*",
                       "audible", "icloud", "patreon", "openai", "domain#"]),
    ("Shopping", ["amazon", "amzn", "tj maxx", "ross store", "five below", "hobbylobby",
                  "hobby lobby", "lowe's", "lowes", "tractor-supply", "tractor supply",
                  "best buy", "target", "ebay", "etsy", "disney gifts", "goodwill",
                  "wal-mart", "walmart", "wm supercenter", "wm superc"]),
    ("Health & Fitness", ["anytime fitne", "anytime fitness", "cvs", "walgreens", "pharmacy",
                          "fitness", "dental", "clinic"]),
    ("Kids & School", ["scholastic", "great clips", "jostens", "shutterfly", "lifetouch",
                       "background checks"]),
    ("Hobbies", ["golf cours", "tututix", "roblox", "signup *"]),
    ("Auto", ["u-haul", "jiffy lube", "valvoline", "sunpass", "secretary of",
              "tire ", "car wash", "autozone", "o'reilly"]),
    ("Travel", ["hampton inn", "resort", "medieval times", "hotel", "airbnb",
                "airlines", "delta air", "southwest air", "expedia", "marriott", "hilton"]),
    ("Loans", ["ecsi", "aidvantage", "navient", "mohela", "nelnet", "great lakes"]),
    ("Giving", ["church", "donation", "charity"]),
    ("Fees", ["conv. fee", "biz conv", "service charge", "interest charge", "overdraft"]),
    ("Transfer", ["zelle", "venmo", "paypal", "cash app", "visa direct", "transfer"]),
]


def rule_matches(r, text: str, amt: float, same_day_descs=None) -> bool:
    """Does a learned rule apply? Keyword substring + optional amount band
    (compared against the spend magnitude `amt` = abs(amount)) + optional
    same-day co-occurrence (another transaction that day contains the rule's
    same_day_keyword). `same_day_descs` is an iterable of lowercase descriptions
    present on the transaction's date."""
    kw = (getattr(r, "keyword", "") or "").lower()
    if not kw or kw not in text:
        return False
    lo = getattr(r, "min_amount", None)
    hi = getattr(r, "max_amount", None)
    if lo is not None and not (amt > float(lo)):
        return False
    if hi is not None and not (amt <= float(hi)):
        return False
    sdk = (getattr(r, "same_day_keyword", None) or "").lower()
    if sdk:
        if not same_day_descs or not any(sdk in d for d in same_day_descs):
            return False
    return True


def is_conditional(r) -> bool:
    """True if a rule carries any extra condition beyond a bare keyword."""
    return (getattr(r, "min_amount", None) is not None
            or getattr(r, "max_amount", None) is not None
            or bool(getattr(r, "same_day_keyword", None)))


def categorize(desc: str, amount: float, rules: list, same_day_descs=None) -> str:
    """Pick the best category for a transaction.

    Precedence (highest first): a *learned* rule beats a built-in; a conditional
    learned rule (amount band and/or same-day) beats an unconditional one; within
    a tier the longest matching keyword wins. Falls back to Income/Other by sign.
    """
    text = (desc or "").lower()
    amt = abs(float(amount or 0))
    best = None  # (tier, conditional, keyword_len, category)
    for r in rules:
        if rule_matches(r, text, amt, same_day_descs):
            kw = (getattr(r, "keyword", "") or "").lower()
            cand = (2, 1 if is_conditional(r) else 0, len(kw), getattr(r, "category", ""))
            if best is None or cand[:3] > best[:3]:
                best = cand
    for cat, kws in _BUILTIN_RULES:
        for kw in kws:
            if kw in text:
                cand = (0, 0, len(kw), cat)
                if best is None or cand[:3] > best[:3]:
                    best = cand
    if best:
        return best[3]
    return "Income" if (amount or 0) > 0 else "Other"


# --------------------------------------------------------------------------- #
# Merchant-name normalization
# --------------------------------------------------------------------------- #

_PHONE = re.compile(r"\d{3}[-.\s]?\d{3}[-.\s]?\d{4}")
_TRAIL_STATE = re.compile(r"\b[A-Za-z]{2}\b\s*$")
_DIGIT_RUN = re.compile(r"#?\d{3,}")   # store/auth codes (3+ digits) anywhere
_PROCESSOR = re.compile(r"^[a-z0-9]{2,4}\*\s*", re.IGNORECASE)
_ARTICLES = {"the", "a", "an"}

# Transaction-TYPE prefixes some banks put before the merchant ("POS DEBIT
# <gap> KROGER..."). Must be stripped BEFORE the big-gap split below, or the
# gap after the prefix makes every such row's "merchant" the prefix itself —
# which once linked 29 unrelated POS DEBIT transactions to one bill.
_TX_TYPE_PREFIX = re.compile(
    r"^(?:pos debit|pos purchase|pos|debit card purchase|check card purchase|"
    r"dbt crd|recurring payment|ach debit|ach credit)\b[\s:#-]*",
    re.IGNORECASE)

# Keys too generic to identify a merchant — never group/fan-out on these.
GENERIC_MERCHANT_KEYS = {
    "pos debit", "pos", "debit", "ach", "online payment", "online transfer",
    "payment", "transfer", "withdrawal", "deposit", "unknown",
}


def merchant_key(desc: str) -> str:
    """A cleaned, display-friendly merchant name for grouping/showing.

    Strips the leading transaction-type prefix, the trailing date block, phone
    numbers, store/auth code numbers (which vary per swipe and would otherwise
    fragment grouping), and the trailing state code from a raw bank description.
    """
    raw = (desc or "").strip()
    head = _TX_TYPE_PREFIX.sub("", raw)
    # Chase pads the trailing "MM/DD" with lots of spaces — cut at the first big gap.
    head = re.split(r"\s{2,}", head)[0]
    head = _PHONE.sub(" ", head)
    head = _DIGIT_RUN.sub(" ", head)
    head = re.sub(r"\s+", " ", head).strip()
    head = _TRAIL_STATE.sub("", head).strip(" -#.")
    return head.title() if head else (raw[:24] or "Unknown")


def is_generic_merchant_key(key: str) -> bool:
    """True when a merchant key is too vague to safely treat as one merchant."""
    return len(key.strip()) < 3 or key.strip().lower() in GENERIC_MERCHANT_KEYS


def suggest_keyword(desc: str) -> str:
    """Suggest a short, lowercase keyword for a learned rule (the first couple of
    significant words of the merchant name). The user can refine it."""
    mk = _PROCESSOR.sub("", merchant_key(desc).lower())
    toks = [t for t in re.split(r"[^a-z0-9&.'/]+", mk) if t and t not in _ARTICLES and not t.isdigit()]
    return " ".join(toks[:2]) if toks else mk


def seed_default_categories(db, model) -> None:
    """Insert the default categories if the table is empty. Idempotent."""
    if model.query.first():
        return
    for i, (name, color) in enumerate(DEFAULT_CATEGORIES):
        db.session.add(model(name=name, color=color, sort_order=i))
    db.session.commit()
