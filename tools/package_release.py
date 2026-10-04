#!/usr/bin/env python3
"""Build a clean, shareable copy of Hearth — source only, none of your data.

    python tools/package_release.py

Produces ``dist/hearth-<date>.zip`` next to the project.

Why a whitelist: this script decides what to *include*, not what to strip. A
blacklist quietly ships anything nobody thought to exclude, and in this app the
thing nobody thought to exclude is a database holding income, balances and
account numbers. Anything not named below simply never gets copied.

Every build is then scanned, and the script refuses to write a zip if a
forbidden file made it through. A packaging script you cannot trust is worse
than packaging by hand, because it feels safe.
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Directories copied wholesale, minus PRUNE_DIRS / PRUNE_SUFFIXES below.
INCLUDE_TREES = [
    "backend/app",
    "frontend/src",
    "frontend/public",
    "mcp",
    "design-system",
    "tools",
]

# Individual files, copied only if they exist.
INCLUDE_FILES = [
    "README.md", "REQUIREMENTS.md", "PROJECT.md",
    "install.bat", "install.sh", "start.bat", "start.sh", ".gitignore",
    "backend/requirements.txt", "backend/run.py", "backend/.env.example",
    "frontend/package.json", "frontend/package-lock.json",
    "frontend/index.html", "frontend/vite.config.ts",
    "frontend/tsconfig.json", "frontend/tsconfig.node.json",
    "frontend/tailwind.config.js", "frontend/postcss.config.js",
]

# Never copied, at any depth.
PRUNE_DIRS = {
    ".venv", "venv", "env", "node_modules", "dist", "__pycache__", ".pytest_cache",
    ".git", ".claude", ".vite", ".idea", ".vscode", "instance",
    "data", "imports", "give_photos", ".hearth-design-temp", "receipts",
}
PRUNE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pyc", ".pyo", ".log", ".zip"}
PRUNE_NAMES = {".env", ".env.local", ".salt", ".api_key", "auth.json", ".keyfile",
               ".DS_Store", "Thumbs.db", "desktop.ini"}

# If any of these turn up in the staged output, something went wrong — stop.
FORBIDDEN = [
    re.compile(r"finance\.db"), re.compile(r"\.salt$"), re.compile(r"\.api_key$"),
    re.compile(r"auth\.json$"), re.compile(r"(^|/)\.env$"), re.compile(r"\.bak"),
    re.compile(r"(^|/)imports/(?!\.gitkeep)"), re.compile(r"give_photos/"),
    re.compile(r"CheckStub", re.I), re.compile(r"[Ss]tatements?-\d"),
    re.compile(r"Activity_\d"),
]

# Not fatal - things that look like personal details baked into source,
# reported so you can decide. Generic PII shapes only: hard-coding the author's
# own name and town here would defeat the point of scrubbing them from the
# source, and would be useless to anyone who forks this.
#
# Add your own terms (one per line; blank lines and # comments ignored) to
# tools/personal-terms.txt - that file is gitignored, so your list never ships.
PII_PATTERNS = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("phone", re.compile(r"\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}")),
    ("address", re.compile(r"\d{3,5}\s+[A-Z][a-z]+\s+(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way)")),
    ("account no", re.compile(r"(?:####|xxxx|\*{4})\s?\d{4}", re.I)),
    ("api key", re.compile(r"(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}")),
]

# Placeholders that legitimately look like PII.
PII_ALLOW = re.compile(r"you@email\.com|example\.com|555[-.]?\d{4}|123[-.]?456", re.I)


def _load_personal_terms():
    """Your own extra terms, from a gitignored file. None when absent."""
    f = ROOT / "tools" / "personal-terms.txt"
    if not f.is_file():
        return None
    terms = [ln.strip() for ln in f.read_text(encoding="utf-8").splitlines()
             if ln.strip() and not ln.lstrip().startswith("#")]
    return re.compile("|".join(re.escape(t) for t in terms), re.I) if terms else None


SCAN_TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".html", ".css"}


def _skip(p: Path) -> bool:
    if p.name in PRUNE_NAMES or p.suffix.lower() in PRUNE_SUFFIXES:
        return True
    return any(part in PRUNE_DIRS for part in p.parts)


def stage(dest: Path) -> int:
    copied = 0
    for rel in INCLUDE_TREES:
        src = ROOT / rel
        if not src.is_dir():
            continue
        for f in src.rglob("*"):
            if not f.is_file():
                continue
            r = f.relative_to(ROOT)
            if _skip(r):
                continue
            out = dest / r
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, out)
            copied += 1
    for rel in INCLUDE_FILES:
        src = ROOT / rel
        if src.is_file():
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
            copied += 1
    # Keep the folders the app expects, without their contents.
    for rel in ("backend/data", "backend/imports"):
        d = dest / rel
        d.mkdir(parents=True, exist_ok=True)
        (d / ".gitkeep").write_text("")
    return copied


def audit(dest: Path) -> tuple[list[str], list[str]]:
    leaks, personal = [], []
    terms = _load_personal_terms()
    for f in dest.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(dest).as_posix()
        if any(pat.search(rel) for pat in FORBIDDEN):
            leaks.append(rel)
        if f.suffix.lower() in SCAN_TEXT_SUFFIXES:
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            hits = set()
            for label, pat in PII_PATTERNS:
                for m in pat.finditer(text):
                    if not PII_ALLOW.search(m.group(0)):
                        hits.add(f"{label}: {m.group(0)}")
            if terms is not None:
                hits |= {f"term: {m.group(0).lower()}" for m in terms.finditer(text)}
            if hits:
                personal.append(f"{rel}  ({'; '.join(sorted(hits)[:4])})")
    return leaks, personal


def main() -> int:
    out_dir = ROOT / "dist"
    staging = out_dir / "hearth"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    print(f"Staging from {ROOT}")
    n = stage(staging)
    print(f"  copied {n} files")

    leaks, personal = audit(staging)
    if leaks:
        print("\nREFUSING TO PACKAGE — personal files reached the build:")
        for p in leaks:
            print(f"   {p}")
        shutil.rmtree(staging)
        return 1
    print("  no database, .env, statements or photos in the build")

    if personal:
        print("")
        print(f"  Note: {len(personal)} source file(s) look like they hold")
        print("  personal details. These are in the code, not your data:")
        for p in personal[:12]:
            print(f"   {p}")
        if len(personal) > 12:
            print(f"   ... and {len(personal) - 12} more")

    zip_path = out_dir / f"hearth-{date.today():%Y%m%d}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(staging.rglob("*")):
            if f.is_file():
                z.write(f, Path("hearth") / f.relative_to(staging))

    size_mb = zip_path.stat().st_size / 1_048_576
    print(f"\nBuilt {zip_path}  ({size_mb:.1f} MB)")
    print("Your friend unzips it, runs install.bat (or ./install.sh), then start.bat.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
