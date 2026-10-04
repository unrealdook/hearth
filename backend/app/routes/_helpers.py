"""Shared route helpers."""
from functools import wraps
from flask import request, jsonify, current_app
from ..services import auth as auth_service


# Blueprints that touch encrypted secrets or whole-DB material. A read-only
# API key (which carries no Fernet key) must never reach these, even via GET.
_API_KEY_FORBIDDEN_BLUEPRINTS = {"credentials", "backup"}

# Narrow write carve-out: blueprints a (otherwise read-only) API key may POST to.
# The Home Automation app pushes energy waste events here. Kept deliberately
# small and explicit — only POST (no PUT/DELETE), only the listed blueprints —
# rather than loosening the global read-only rule. These endpoints store only
# non-secret, non-financial-core data (an append-only energy ledger).
_API_KEY_WRITABLE_BLUEPRINTS = {"energy"}


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not auth_service.is_configured(current_app):
            return jsonify(error="not_configured"), 401

        # Read-only API key path (local automation / MCP). Scoped down hard:
        # GET/HEAD only, no Fernet key, never on secret-bearing blueprints.
        api_key = request.headers.get("X-Hearth-Api-Key")
        if api_key:
            if not auth_service.verify_api_key(current_app, api_key):
                return jsonify(error="invalid_api_key"), 401
            if request.blueprint in _API_KEY_FORBIDDEN_BLUEPRINTS:
                return jsonify(
                    error="forbidden",
                    message="This endpoint is not available to read-only API keys.",
                ), 403
            # Reads are always allowed; writes only to the narrow carve-out
            # blueprints, and only via POST.
            is_read = request.method in ("GET", "HEAD")
            is_allowed_write = (
                request.method == "POST"
                and request.blueprint in _API_KEY_WRITABLE_BLUEPRINTS
            )
            if not (is_read or is_allowed_write):
                return jsonify(
                    error="read_only",
                    message="This API key is read-only; only GET requests are permitted.",
                ), 403
            request.hearth_session = {"read_only": True, "fernet_key": None}
            return fn(*args, **kwargs)

        session = auth_service.require_session(request)
        if not session:
            return jsonify(error="unauthorized"), 401
        request.hearth_session = session
        return fn(*args, **kwargs)
    return wrapper


def get_session_key():
    """Return the Fernet key string from the active session, or None."""
    s = getattr(request, "hearth_session", None)
    if not s:
        return None
    return s.get("fernet_key")
