"""Tiny CLI: `python -m app.cli init-db` etc."""
import sys
from . import create_app
from .models import db
from .services import auth as auth_service


def init_db():
    app = create_app()
    with app.app_context():
        db.create_all()
        print("Database initialized.")


def gen_api_key():
    """Create or replace the read-only API key used by local automation (MCP)."""
    app = create_app()
    key = auth_service.generate_api_key(app)
    print("Read-only API key generated (stored in backend/data/.api_key):\n")
    print(f"    {key}\n")
    print("Give this to the Hearth MCP server via the HEARTH_API_KEY env var,")
    print("or leave it in the file — the MCP server reads it automatically.")
    print("It is READ-ONLY: GET requests only, and it cannot decrypt credentials.")


def show_api_key():
    app = create_app()
    key = auth_service.get_api_key(app)
    if key:
        print(key)
    else:
        print("No API key set. Run: python -m app.cli gen-api-key")
        sys.exit(1)


def revoke_api_key():
    app = create_app()
    if auth_service.revoke_api_key(app):
        print("API key revoked.")
    else:
        print("No API key to revoke.")


def main():
    cmds = {
        "init-db": init_db,
        "gen-api-key": gen_api_key,
        "show-api-key": show_api_key,
        "revoke-api-key": revoke_api_key,
    }
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(f"usage: python -m app.cli <{' | '.join(cmds)}>")
        sys.exit(1)
    cmds[sys.argv[1]]()


if __name__ == "__main__":
    main()
