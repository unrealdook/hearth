from flask import Blueprint, request, jsonify, current_app
from ..services import auth as auth_service

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.get("/status")
def status():
    return jsonify(configured=auth_service.is_configured(current_app))


@bp.post("/setup")
def setup():
    if auth_service.is_configured(current_app):
        return jsonify(error="already_configured"), 400
    body = request.get_json(silent=True) or {}
    passcode = (body.get("passcode") or "").strip()
    try:
        auth_service.set_passcode(current_app, passcode)
    except ValueError as e:
        return jsonify(error="invalid_passcode", message=str(e)), 400
    token = auth_service.create_session(current_app, passcode)
    return jsonify(ok=True, token=token)


@bp.post("/unlock")
def unlock():
    body = request.get_json(silent=True) or {}
    passcode = (body.get("passcode") or "").strip()
    if not auth_service.verify_passcode(current_app, passcode):
        return jsonify(error="invalid_passcode"), 401
    token = auth_service.create_session(current_app, passcode)
    return jsonify(ok=True, token=token)


@bp.post("/lock")
def lock():
    token = request.headers.get("X-Hearth-Session")
    if token:
        auth_service.revoke_session(token)
    return jsonify(ok=True)


@bp.post("/change-passcode")
def change_passcode():
    body = request.get_json(silent=True) or {}
    current = (body.get("current") or "").strip()
    new = (body.get("new") or "").strip()
    if not auth_service.verify_passcode(current_app, current):
        return jsonify(error="invalid_passcode"), 401
    try:
        auth_service.set_passcode(current_app, new)
    except ValueError as e:
        return jsonify(error="invalid_passcode", message=str(e)), 400
    # NOTE: stored encrypted credentials become unreadable after this; users will
    # need to re-enter them. Returning the count so the UI can warn.
    return jsonify(ok=True, message="Passcode changed. Stored credentials must be re-entered.")
