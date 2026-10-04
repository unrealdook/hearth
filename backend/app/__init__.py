import os
from pathlib import Path
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from .models.db import db
from .services import auth as auth_service


def create_app():
    base = Path(__file__).resolve().parent.parent
    load_dotenv(base / ".env")

    app = Flask(__name__)

    data_dir = base / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (base / "imports").mkdir(parents=True, exist_ok=True)

    db_url = os.environ.get("DATABASE_URL", f"sqlite:///{data_dir / 'finance.db'}")
    app.config.update(
        SQLALCHEMY_DATABASE_URI=db_url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        DATA_DIR=str(data_dir),
        IMPORTS_DIR=str(base / "imports"),
        SALT_PATH=str(data_dir / ".salt"),
        AUTH_PATH=str(data_dir / "auth.json"),
        OLLAMA_URL=os.environ.get("OLLAMA_URL", "http://localhost:11434"),
        OLLAMA_MODEL=os.environ.get("OLLAMA_MODEL", "qwen2.5"),
        SECRET_KEY=os.environ.get("FLASK_SECRET", "hearth-local-dev"),
    )

    CORS(app, resources={r"/api/*": {"origins": [
        "http://127.0.0.1:5175", "http://localhost:5175",
    ]}}, supports_credentials=True)

    db.init_app(app)
    with app.app_context():
        db.create_all()
    from .services.migrate import ensure_schema
    ensure_schema(app)

    # blueprints
    from .routes.auth import bp as auth_bp
    from .routes.bills import bp as bills_bp
    from .routes.payments import bp as payments_bp
    from .routes.income import bp as income_bp
    from .routes.debt import bp as debt_bp
    from .routes.savings import bp as savings_bp
    from .routes.imports_ import bp as imports_bp
    from .routes.analytics import bp as analytics_bp
    from .routes.ai import bp as ai_bp
    from .routes.fico import bp as fico_bp
    from .routes.credentials import bp as credentials_bp
    from .routes.budget import bp as budget_bp
    from .routes.give import bp as give_bp
    from .routes.reports import bp as reports_bp
    from .routes.usage import bp as usage_bp
    from .routes.annual_income import bp as annual_income_bp
    from .routes.business import bp as business_bp
    from .routes.backup import bp as backup_bp
    from .routes.categories import bp as categories_bp
    from .routes.energy import bp as energy_bp

    for bp in [auth_bp, bills_bp, payments_bp, income_bp, debt_bp, savings_bp,
               imports_bp, analytics_bp, ai_bp, fico_bp, credentials_bp, budget_bp,
               give_bp, reports_bp, usage_bp, annual_income_bp, business_bp, backup_bp,
               categories_bp, energy_bp]:
        app.register_blueprint(bp)

    @app.get("/api/health")
    def health():
        return jsonify(ok=True, auth_configured=auth_service.is_configured(app))

    @app.errorhandler(404)
    def not_found(e):
        return jsonify(error="not_found"), 404

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify(error="bad_request", message=str(e.description if hasattr(e, 'description') else e)), 400

    return app
