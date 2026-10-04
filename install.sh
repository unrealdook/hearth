#!/usr/bin/env bash
# ===================================================================
# Hearth first-time setup (macOS / Linux).
# Safe to re-run: every step checks before it acts.
# ===================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  Hearth setup"
echo "  ============"
echo

# --- prerequisites -------------------------------------------------
# Fail here with a real message rather than three steps later with a
# stack trace about a missing module.
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      PY="$cand"; break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "  [X] Python 3.11+ not found. Install it, then re-run this script."
  exit 1
fi
echo "  [ok] $("$PY" --version)"

if ! command -v npm >/dev/null 2>&1; then
  echo "  [X] Node/npm not found. Install Node 18+ from https://nodejs.org"
  exit 1
fi
echo "  [ok] Node $(node --version)"
echo

# --- backend -------------------------------------------------------
if [ ! -x "backend/.venv/bin/python" ]; then
  echo "  Creating Python virtualenv..."
  "$PY" -m venv backend/.venv
else
  echo "  [ok] Virtualenv already exists"
fi
VENV_PY="backend/.venv/bin/python"

echo "  Installing Python packages (a minute or two)..."
"$VENV_PY" -m pip install --upgrade pip --quiet
"$VENV_PY" -m pip install -r backend/requirements.txt --quiet
echo "  [ok] Python packages installed"

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "  [ok] Created backend/.env from the example"
else
  echo "  [ok] backend/.env already exists (left alone)"
fi

# --- database ------------------------------------------------------
# Tables are created on first boot, but doing it here means a failure
# shows up now instead of behind a browser spinner.
echo "  Creating the database..."
"$VENV_PY" -c "import sys; sys.path.insert(0,'backend'); from app import create_app; create_app()"
echo "  [ok] Database ready at backend/data/finance.db"

# --- frontend ------------------------------------------------------
echo "  Installing frontend packages (this one takes longer)..."
( cd frontend && npm install --silent )
echo "  [ok] Frontend packages installed"

chmod +x start.sh 2>/dev/null || true

cat <<'DONE'

  ===================================================
  Done. Start Hearth with:   ./start.sh

  Then open http://127.0.0.1:5175 and pick a 4-digit
  passcode. That passcode also encrypts any bill
  logins you save, so it cannot be recovered - write
  it down somewhere.
  ===================================================

DONE
