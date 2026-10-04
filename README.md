# Hearth — Personal Finance Tracker

A locally hosted personal finance app. Tracks bills, payments, income, debt, savings, investments, FICO history, and gives AI-powered insights via a local Ollama install. Calm, dark, single-user.

## Stack
- **Backend**: Python + Flask + SQLAlchemy + SQLite
- **Frontend**: React + TypeScript + Vite + Tailwind, styled with the **Hearth Design System** (see `design-system/`)
- **AI**: local Ollama (Qwen 2.5) at `http://localhost:11434`
- **Auth**: 4-digit passcode (used to derive the Fernet key for the credential vault)

## Install

Hearth runs entirely on your own machine. There is no server, no account and no
multi-user mode — each install has its own database, and nothing leaves the box
except a call to Ollama on localhost if you use the AI page.

You need **Python 3.11+** and **Node 18+** on your PATH. Then:

```bash
git clone <this-repo> hearth
cd hearth
install.bat          # Windows
./install.sh         # macOS / Linux
```

That creates the virtualenv, installs both dependency sets, writes
`backend/.env` from the example, and builds the database. It is safe to re-run.

Then start it:

```bash
start.bat            # Windows
./start.sh           # macOS / Linux
```

- Frontend: <http://127.0.0.1:5175>
- Backend API: <http://127.0.0.1:5274>

### Manual setup

If you would rather not run the script:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate      # macOS / Linux
pip install -r requirements.txt
cp .env.example .env
python run.py                    # tables are created on boot

cd ../frontend
npm install
npm run dev
```

> **Do not set `DATABASE_URL` to a relative path.** Flask-SQLAlchemy resolves a
> relative sqlite path against `backend/instance/`, not the project, so
> `sqlite:///data/finance.db` fails with *unable to open database file*. Leave it
> unset (the default is correct) or give an absolute path.

### Ollama (optional)

Only the AI Insights page needs it; everything else works without it.
`ollama serve`, then `ollama pull llama3.2:3b` and set `OLLAMA_MODEL` in
`backend/.env`.

## First launch

On first launch the app prompts you to set a 4-digit passcode. That passcode:
- gates access to the app on every reload, and
- derives (via PBKDF2) the Fernet key used to encrypt stored bill credentials.

If you forget it: delete `backend/data/finance.db` and `backend/data/.salt` to reset (you'll lose stored credentials but not bill data — credentials are stored separately).

## Layout
```
hearth-personal-finance/
├── backend/        Flask + SQLite API
├── frontend/       React + Vite app
├── design-system/  Hearth Design System bundle (read-only reference)
└── README.md
```

See `design-system/project/README.md` for the design tokens and voice guide. The frontend ports those tokens 1:1 into `frontend/src/styles/hearth.css`.
