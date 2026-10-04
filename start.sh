#!/usr/bin/env bash
# Mac/Linux quick-start: launches backend and frontend in parallel.
set -e
cd "$(dirname "$0")"

if [ -d backend/.venv ]; then
  source backend/.venv/bin/activate
fi

(cd backend && python run.py) &
BACK=$!

(cd frontend && npm run dev) &
FRONT=$!

trap "kill $BACK $FRONT 2>/dev/null" EXIT
wait
