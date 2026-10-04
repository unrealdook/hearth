@echo off
setlocal enabledelayedexpansion
REM ===================================================================
REM Hearth first-time setup (Windows).
REM Safe to re-run: every step checks before it acts.
REM ===================================================================
cd /d "%~dp0"
echo.
echo   Hearth setup
echo   ============
echo.

REM --- prerequisites -------------------------------------------------
REM Fail here with a real message rather than three steps later with a
REM stack trace about a missing module.
where python >nul 2>&1
if errorlevel 1 (
    echo   [X] Python not found on PATH.
    echo       Install Python 3.11+ from https://python.org and tick
    echo       "Add python.exe to PATH" in the installer.
    echo.
    pause & exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo   [ok] Python !PYVER!

where npm >nul 2>&1
if errorlevel 1 (
    echo   [X] Node/npm not found on PATH.
    echo       Install Node 18+ from https://nodejs.org
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>^&1') do set NODEVER=%%v
echo   [ok] Node !NODEVER!
echo.

REM --- backend -------------------------------------------------------
if not exist "backend\.venv\Scripts\python.exe" (
    echo   Creating Python virtualenv...
    python -m venv backend\.venv
    if errorlevel 1 ( echo   [X] Could not create the virtualenv. & pause & exit /b 1 )
) else (
    echo   [ok] Virtualenv already exists
)

echo   Installing Python packages ^(a minute or two^)...
backend\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --quiet
if errorlevel 1 ( echo   [X] pip install failed. & pause & exit /b 1 )
echo   [ok] Python packages installed

if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo   [ok] Created backend\.env from the example
) else (
    echo   [ok] backend\.env already exists ^(left alone^)
)

REM --- database ------------------------------------------------------
REM Tables are created on first boot, but doing it here means a failure
REM shows up now instead of behind a browser spinner.
echo   Creating the database...
backend\.venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'backend'); from app import create_app; create_app(); print('   [ok] Database ready at backend/data/finance.db')"
if errorlevel 1 ( echo   [X] Database setup failed. & pause & exit /b 1 )

REM --- frontend ------------------------------------------------------
echo   Installing frontend packages ^(this one takes longer^)...
pushd frontend
call npm install --silent
if errorlevel 1 ( echo   [X] npm install failed. & popd & pause & exit /b 1 )
popd
echo   [ok] Frontend packages installed

echo.
echo   ===================================================
echo   Done. Start Hearth with:   start.bat
echo.
echo   Then open http://127.0.0.1:5175 and pick a 4-digit
echo   passcode. That passcode also encrypts any bill
echo   logins you save, so it cannot be recovered - write
echo   it down somewhere.
echo   ===================================================
echo.
pause
