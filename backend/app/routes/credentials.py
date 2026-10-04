from flask import Blueprint, jsonify
from ..models import db, Bill
from ..services import encryption
from ._helpers import require_auth, get_session_key

bp = Blueprint("credentials", __name__, url_prefix="/api/credentials")


@bp.get("/<int:bill_id>")
@require_auth
def get_credentials(bill_id):
    bill = db.session.get(Bill, bill_id)
    if not bill:
        return jsonify(error="not_found"), 404
    key = get_session_key()
    return jsonify({
        "bill_id": bill.id,
        "username": encryption.decrypt(bill.username_enc, key),
        "password": encryption.decrypt(bill.password_enc, key),
    })
