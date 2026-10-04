"""
Local single-user 4-digit passcode auth.

The passcode is hashed (PBKDF2 + per-app salt) and stored in auth.json.
The same passcode also derives the Fernet key used by encryption.py — so
unlocking the app and unlocking the credential vault are the same act.

A bearer session token is held in memory after a successful unlock and
must accompany every protected request via the X-Hearth-Session header.
"""
from __future__ import annotations
import json
import os
import secrets
import time
import hmac
import hashlib
from pathlib import Path
from typing import Optional
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


PBKDF2_ITERATIONS = 200_000
SESSION_TTL_SECONDS = 60 * 60 * 8   # 8 hours


# in-memory session store (single-user, single-process)
_sessions: dict[str, dict] = {}


def _salt_path(app) -> Path:
    return Path(app.config["SALT_PATH"])


def _auth_path(app) -> Path:
    return Path(app.config["AUTH_PATH"])


def _api_key_path(app) -> Path:
    return Path(app.config["DATA_DIR"]) / ".api_key"


def _ensure_salt(app) -> bytes:
    p = _salt_path(app)
    if p.exists():
        return p.read_bytes()
    salt = secrets.token_bytes(32)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(salt)
    try:
        os.chmod(p, 0o600)
    except Exception:
        pass
    return salt


def _hash_passcode(passcode: str, salt: bytes) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", passcode.encode("utf-8"), salt, PBKDF2_ITERATIONS, 32)
    return dk.hex()


def is_configured(app) -> bool:
    return _auth_path(app).exists()


def set_passcode(app, passcode: str) -> None:
    if not (passcode.isdigit() and len(passcode) == 4):
        raise ValueError("Passcode must be 4 digits.")
    salt = _ensure_salt(app)
    h = _hash_passcode(passcode, salt)
    p = _auth_path(app)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"hash": h, "set_at": int(time.time())}))
    try:
        os.chmod(p, 0o600)
    except Exception:
        pass


def verify_passcode(app, passcode: str) -> bool:
    if not is_configured(app):
        return False
    salt = _ensure_salt(app)
    stored = json.loads(_auth_path(app).read_text())["hash"]
    return hmac.compare_digest(stored, _hash_passcode(passcode, salt))


def derive_fernet_key(app, passcode: str) -> bytes:
    """Derive the URL-safe base64 Fernet key from passcode + app salt."""
    import base64
    salt = _ensure_salt(app)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS)
    raw = kdf.derive(passcode.encode("utf-8"))
    return base64.urlsafe_b64encode(raw)


def create_session(app, passcode: str) -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "created": time.time(),
        "fernet_key": derive_fernet_key(app, passcode).decode("ascii"),
    }
    return token


def get_session(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    s = _sessions.get(token)
    if not s:
        return None
    if time.time() - s["created"] > SESSION_TTL_SECONDS:
        _sessions.pop(token, None)
        return None
    return s


def revoke_session(token: str) -> None:
    _sessions.pop(token, None)


# ---------------------------------------------------------------------------
# Read-only API key
#
# A separate, scoped credential for local automation (e.g. the Hearth MCP
# server) that lets a trusted local process read finance data WITHOUT the
# 4-digit passcode. It is deliberately weaker in scope than a passcode
# session: it carries NO Fernet key, so it can never decrypt stored bill
# credentials, and callers (see routes/_helpers.require_auth) only honour it
# for GET/HEAD requests. The key itself is a local file, readable only by the
# owner — the same trust boundary as finance.db sitting next to it.
# ---------------------------------------------------------------------------

def has_api_key(app) -> bool:
    return _api_key_path(app).exists()


def get_api_key(app) -> Optional[str]:
    p = _api_key_path(app)
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8").strip() or None


def generate_api_key(app) -> str:
    """Create (or replace) the read-only API key and persist it. Returns the key."""
    key = "hearth_" + secrets.token_urlsafe(32)
    p = _api_key_path(app)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(key, encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except Exception:
        pass
    return key


def revoke_api_key(app) -> bool:
    p = _api_key_path(app)
    if p.exists():
        p.unlink()
        return True
    return False


def verify_api_key(app, candidate: Optional[str]) -> bool:
    stored = get_api_key(app)
    if not stored or not candidate:
        return False
    return hmac.compare_digest(stored, candidate.strip())


def require_session(req) -> Optional[dict]:
    # Header is the primary path. Fall back to a query param so <img src> tags
    # (which can't set custom headers) can still authenticate against media routes.
    token = req.headers.get("X-Hearth-Session") or req.args.get("t")
    return get_session(token)
