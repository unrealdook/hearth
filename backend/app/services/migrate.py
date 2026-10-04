"""
Tiny in-line SQLite schema migrator.

We don't use Alembic yet — the app is single-user and local. Instead, on every
boot we ask SQLite for each table's columns and add anything missing. Strictly
additive: we never drop or rename here.
"""
import re

from sqlalchemy import text
from ..models import db


# (table, column, ddl-fragment-after-ADD-COLUMN)
EXPECTED_COLUMNS: list[tuple[str, str, str]] = [
    ("bills", "balance_remaining", "NUMERIC(14, 2)"),
    ("incomes", "gross_amount", "NUMERIC(12, 2)"),
    ("incomes", "federal_tax", "NUMERIC(12, 2)"),
    ("incomes", "state_tax", "NUMERIC(12, 2)"),
    ("incomes", "fica", "NUMERIC(12, 2)"),
    ("incomes", "retirement_401k_amount", "NUMERIC(12, 2)"),
    ("incomes", "health_insurance", "NUMERIC(12, 2)"),
    ("incomes", "other_deductions", "NUMERIC(12, 2)"),
    ("incomes", "paycheck_retirement_account_id", "INTEGER"),
    ("incomes", "start_date", "DATE"),
    ("incomes", "end_date", "DATE"),
    ("payment_records", "deducted_amount", "NUMERIC(12, 2) DEFAULT 0"),
    ("bills", "usage_unit", "VARCHAR(16)"),
    ("income_events", "gross_amount", "NUMERIC(12, 2)"),
    ("work_entries", "income_event_id", "INTEGER"),
    ("budget_allocations", "give_pct", "NUMERIC(5, 2) DEFAULT 0"),
    ("merchant_rules", "same_day_keyword", "VARCHAR(128)"),
    ("spending_categories", "chart_hidden", "BOOLEAN DEFAULT 0"),
    ("spending_categories", "monthly_budget", "NUMERIC(12, 2)"),
    ("savings_accounts", "is_business", "BOOLEAN DEFAULT 0"),
    ("annual_income", "partner_amount", "NUMERIC(14, 2)"),
    ("debts", "group_name", "VARCHAR(128)"),
    ("spending_categories", "reimbursable", "BOOLEAN DEFAULT 0"),
    ("spending_categories", "offset_category_id", "INTEGER"),
    ("business_expenses", "contractor_id", "INTEGER"),
    ("savings_accounts", "sort_order", "INTEGER DEFAULT 0"),
    ("projects", "crm_opportunity_id", "INTEGER"),
    ("projects", "crm_synced_at", "DATETIME"),
    ("work_entries", "amount_override", "NUMERIC(12, 2)"),
    ("work_entries", "source", "VARCHAR(16) DEFAULT 'manual'"),
    ("work_entries", "crm_ref", "VARCHAR(64)"),
    ("payment_records", "skip_deduction", "BOOLEAN"),
    ("income_events", "paycheck_id", "INTEGER"),
    ("imported_transactions", "account_id", "INTEGER"),
    ("imported_transactions", "balance_after", "NUMERIC(14, 2)"),
    ("bills", "paid_off_on", "DATE"),
]


def _rebuild_merchant_rules(conn, app):
    """merchant_rules originally had UNIQUE(keyword) and no amount columns. To
    support several amount-banded rules per merchant we must drop the unique
    constraint (which SQLite bakes into the table) and add min/max_amount — a
    table rebuild. Guarded on the presence of the new column."""
    rows = conn.execute(text('PRAGMA table_info("merchant_rules")')).fetchall()
    cols = {r[1] for r in rows}
    if not cols or "min_amount" in cols:
        return  # not created yet (create_all handles fresh), or already migrated
    conn.execute(text("ALTER TABLE merchant_rules RENAME TO merchant_rules_old"))
    conn.execute(text(
        "CREATE TABLE merchant_rules ("
        " id INTEGER PRIMARY KEY,"
        " keyword VARCHAR(128) NOT NULL,"
        " category VARCHAR(64) NOT NULL,"
        " min_amount NUMERIC(12, 2),"
        " max_amount NUMERIC(12, 2),"
        " same_day_keyword VARCHAR(128),"
        " created_at DATETIME)"))
    conn.execute(text(
        "INSERT INTO merchant_rules (id, keyword, category, created_at) "
        "SELECT id, keyword, category, created_at FROM merchant_rules_old"))
    conn.execute(text("DROP TABLE merchant_rules_old"))
    conn.commit()
    app.logger.info("Migrated: rebuilt merchant_rules (amount bands, non-unique keyword)")


def _merge_bills_category(conn, app):
    """One-time: collapse Insurance / Internet & Phone / Utilities into a single
    'Bills' category (streaming is handled by the built-in rules). Keyed in
    app_settings so it runs once and never fights later user edits."""
    done = conn.execute(text(
        "SELECT value FROM app_settings WHERE key='cat_merge_bills_v1'")).fetchone()
    if done:
        return
    if not conn.execute(text('PRAGMA table_info("spending_categories")')).fetchall():
        return  # categories table not created yet
    merged = ("Insurance", "Internet & Phone", "Utilities")
    # A fresh install has nothing to collapse. Inserting 'Bills' here would be
    # actively harmful: seed_default_categories() skips a non-empty table, so
    # that single row would suppress the other ~19 defaults and leave a new
    # user with one category. Let the seeder do its job instead.
    has_any = conn.execute(text("SELECT 1 FROM spending_categories LIMIT 1")).fetchone()
    if not has_any:
        conn.execute(text("INSERT OR REPLACE INTO app_settings (key, value) "
                          "VALUES ('cat_merge_bills_v1', '1')"))
        conn.commit()
        return
    # Ensure a Bills category exists (reuse a merged row's color if present).
    has_bills = conn.execute(text(
        "SELECT 1 FROM spending_categories WHERE name='Bills'")).fetchone()
    if not has_bills:
        conn.execute(text(
            "INSERT INTO spending_categories (name, color, sort_order, archived) "
            "VALUES ('Bills', '#5BA3C4', 5, 0)"))
    # Repoint existing transactions + rules, then drop the merged picker entries.
    for name in merged:
        conn.execute(text("UPDATE imported_transactions SET category='Bills' WHERE category=:n"),
                     {"n": name})
        conn.execute(text("UPDATE merchant_rules SET category='Bills' WHERE category=:n"),
                     {"n": name})
        conn.execute(text("DELETE FROM spending_categories WHERE name=:n"), {"n": name})
    conn.execute(text("INSERT OR REPLACE INTO app_settings (key, value) "
                      "VALUES ('cat_merge_bills_v1', '1')"))
    conn.commit()
    app.logger.info("Migrated: merged Insurance/Internet/Utilities into Bills")


def _default_hide_transfer(conn, app):
    """One-time: hide the Transfer category from spending charts by default
    (money moved to pay bills isn't real spend). Keyed so it runs once and won't
    fight a user who re-enables it later."""
    done = conn.execute(text(
        "SELECT value FROM app_settings WHERE key='cat_hide_transfer_v1'")).fetchone()
    if done:
        return
    if not conn.execute(text('PRAGMA table_info("spending_categories")')).fetchall():
        return
    conn.execute(text("UPDATE spending_categories SET chart_hidden=1 WHERE name='Transfer'"))
    conn.execute(text("INSERT OR REPLACE INTO app_settings (key, value) "
                      "VALUES ('cat_hide_transfer_v1', '1')"))
    conn.commit()
    app.logger.info("Migrated: hid Transfer from spending charts by default")


def _seed_account_order(conn, app):
    """One-time: give existing cash accounts an explicit display order. Seeds
    the order they already read in (bucket, then name) but sinks business
    accounts to the bottom — they aren't personal money and shouldn't head the
    list just because of their name. After this the order is the user's to set."""
    done = conn.execute(text(
        "SELECT value FROM app_settings WHERE key='savings_sort_order_v1'")).fetchone()
    if done:
        return
    if not conn.execute(text('PRAGMA table_info("savings_accounts")')).fetchall():
        return
    rows = conn.execute(text(
        "SELECT id FROM savings_accounts "
        "ORDER BY COALESCE(is_business, 0) ASC, bucket ASC, name ASC")).fetchall()
    for i, row in enumerate(rows, start=1):
        conn.execute(text("UPDATE savings_accounts SET sort_order=:o WHERE id=:i"),
                     {"o": i, "i": row[0]})
    conn.execute(text("INSERT OR REPLACE INTO app_settings (key, value) "
                      "VALUES ('savings_sort_order_v1', '1')"))
    conn.commit()
    app.logger.info("Migrated: seeded savings_accounts.sort_order (%d rows)", len(rows))


def _backfill_transaction_account(conn, app):
    """One-time: point existing imported transactions at the account they came
    from, so reconciliation has something to reconcile.

    Only safe when every statement filename shares one account number and
    exactly one cash account is designated pay-from — otherwise we'd be guessing
    which account someone else's rows belong to, and a wrong guess makes a
    reconciliation report confidently incorrect. When it's ambiguous we leave
    account_id NULL and let the user assign it on the next import."""
    done = conn.execute(text(
        "SELECT value FROM app_settings WHERE key='tx_account_backfill_v1'")).fetchone()
    if done:
        return
    if not conn.execute(text('PRAGMA table_info("imported_transactions")')).fetchall():
        return

    pay_from = conn.execute(text(
        "SELECT value FROM app_settings WHERE key='pay_from_account_id'")).fetchone()
    if not pay_from or not pay_from[0]:
        return
    try:
        account_id = int(pay_from[0])
    except (TypeError, ValueError):
        return

    # Every source file must reference the same account number for this to be
    # an inference rather than a guess.
    files = [r[0] or "" for r in conn.execute(text(
        "SELECT DISTINCT source_file FROM imported_transactions")).fetchall()]
    digits = {m for f in files for m in re.findall(r"\d{4,}", f.split("_")[-1] or "")}
    accounts = {m for f in files for m in re.findall(r"(?<![\d])(\d{4})(?![\d])", f)}
    del digits  # filename dates are noise; the 4-digit account token is the signal
    if len(accounts) != 1:
        app.logger.info("Skipped tx account backfill: %d account tokens in filenames",
                        len(accounts))
        return

    n = conn.execute(text("UPDATE imported_transactions SET account_id=:a "
                          "WHERE account_id IS NULL"), {"a": account_id}).rowcount
    conn.execute(text("INSERT OR REPLACE INTO app_settings (key, value) "
                      "VALUES ('tx_account_backfill_v1', '1')"))
    conn.commit()
    app.logger.info("Migrated: assigned %d imported transactions to account %d", n, account_id)


def ensure_schema(app):
    with app.app_context():
        engine = db.engine
        with engine.connect() as conn:
            for table, column, ddl in EXPECTED_COLUMNS:
                rows = conn.execute(text(f'PRAGMA table_info("{table}")')).fetchall()
                existing = {r[1] for r in rows}  # r[1] is the column name
                if column not in existing:
                    conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {column} {ddl}'))
                    conn.commit()
                    app.logger.info("Migrated: added %s.%s", table, column)
            _rebuild_merchant_rules(conn, app)
            _merge_bills_category(conn, app)
            _default_hide_transfer(conn, app)
            _seed_account_order(conn, app)
            _backfill_transaction_account(conn, app)
