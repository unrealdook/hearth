@echo off
REM Windows quick-start: opens two consoles — one for the Flask backend and one
REM for the Vite frontend. Run this from the project root after first-time setup.

REM --- free a stale backend port -----------------------------------------
REM A previous backend (or an orphaned python.exe) may still be holding :5274.
REM That's the usual "address already in use" / "can't reach the backend" cause,
REM so reclaim it before we start.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5274" ^| findstr LISTENING') do (
    echo Freeing port 5274 (killing stale PID %%a)...
    taskkill /f /pid %%a >nul 2>&1
)

REM --- sanity-check the virtualenv ---------------------------------------
REM If the venv is missing we'd silently run system Python (no Flask) and the
REM backend window would crash with a cryptic error. Fail loudly instead.
if not exist "%~dp0backend\.venv\Scripts\python.exe" (
    echo.
    echo [!] No virtualenv found at backend\.venv
    echo     First-time setup:
    echo         cd backend
    echo         python -m venv .venv
    echo         .venv\Scripts\activate
    echo         pip install -r requirements.txt
    echo         python -m app.cli init-db
    echo.
    pause
    exit /b 1
)

REM --- backend -----------------------------------------------------------
REM Call the venv python directly — no activate step to go wrong.
start "Hearth backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe run.py"

REM --- frontend ----------------------------------------------------------
start "Hearth frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend:  http://127.0.0.1:5274
echo Frontend: http://127.0.0.1:5175
echo.
echo The frontend now waits for the backend automatically — if you briefly see
echo "Can't reach the backend", it clears itself once the backend finishes booting.
echo.
