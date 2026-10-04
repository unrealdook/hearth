from datetime import datetime
from .db import db


class Bill(db.Model):
    __tablename__ = "bills"
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(64), nullable=False, default="Other")
    name = db.Column(db.String(128), nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    credit_limit = db.Column(db.Numeric(12, 2))
    due_day = db.Column(db.Integer)            # day of month, 1-31
    term_months = db.Column(db.Integer)        # for loans
    notes = db.Column(db.Text)
    payment_url = db.Column(db.String(512))
    username_enc = db.Column(db.LargeBinary)   # Fernet-encrypted bytes
    password_enc = db.Column(db.LargeBinary)
    is_autopay = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)
    # The day this stopped being owed. Paired with is_active it gives two
    # distinct outcomes, because "paid off" doesn't always mean "done with":
    #   paid_off_on + is_active=False -> closed out (a loan; never bill again)
    #   paid_off_on + is_active=True  -> cleared but still live (a credit card
    #                                    you'll charge again next month)
    paid_off_on = db.Column(db.Date)
    kind = db.Column(db.String(32), default="other")  # for VendorIcon: electric, internet, etc.
    usage_unit = db.Column(db.String(16))              # if set, paying this bill logs a usage reading (e.g. "kWh", "gal")
    balance_remaining = db.Column(db.Numeric(14, 2))   # only meaningful for loans/mortgages
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    payments = db.relationship("PaymentRecord", backref="bill", cascade="all, delete-orphan")

    @property
    def status(self) -> str:
        """One label for the four states a bill can be in, so the UI and the
        API agree on what "paid off" means without re-deriving it."""
        if self.paid_off_on:
            return "paid_off" if not self.is_active else "paid_off_open"
        return "active" if self.is_active else "paused"

    def to_dict(self, include_credentials=False):
        d = {
            "id": self.id,
            "category": self.category,
            "name": self.name,
            "amount": float(self.amount or 0),
            "credit_limit": float(self.credit_limit) if self.credit_limit is not None else None,
            "due_day": self.due_day,
            "term_months": self.term_months,
            "notes": self.notes,
            "payment_url": self.payment_url,
            "is_autopay": bool(self.is_autopay),
            "is_active": bool(self.is_active),
            "paid_off_on": self.paid_off_on.isoformat() if self.paid_off_on else None,
            "status": self.status,
            "kind": self.kind,
            "usage_unit": self.usage_unit,
            "balance_remaining": float(self.balance_remaining) if self.balance_remaining is not None else None,
            "has_credentials": bool(self.username_enc or self.password_enc),
        }
        return d


class PaymentRecord(db.Model):
    __tablename__ = "payment_records"
    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.Integer, db.ForeignKey("bills.id", ondelete="CASCADE"), nullable=False)
    month = db.Column(db.Integer, nullable=False)
    year = db.Column(db.Integer, nullable=False)
    amount_paid = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    paid = db.Column(db.Boolean, default=False)
    paid_date = db.Column(db.DateTime)
    notes = db.Column(db.Text)
    # How much this record has already been deducted from the pay-from account.
    # Lets us apply only the *delta* on edits and refund on unpay/delete, so the
    # checking balance never double-counts. 0 when the auto-deduct feature is off.
    deducted_amount = db.Column(db.Numeric(12, 2), default=0)
    # Whether marking this month paid should leave the balance alone. NULL means
    # "follow the bill" — an auto-pay bill has already moved the money on its own
    # schedule, so deducting again when you get around to ticking it off would
    # double-count. Set True/False to override for a single month.
    skip_deduction = db.Column(db.Boolean)

    __table_args__ = (
        db.UniqueConstraint("bill_id", "month", "year", name="uq_payment_bill_period"),
    )

    def deducts(self, bill=None):
        """Whether this record should move the pay-from balance."""
        if self.skip_deduction is not None:
            return not self.skip_deduction
        bill = bill or self.bill
        return not (bill is not None and bill.is_autopay)

    def to_dict(self, bill=None):
        return {
            "id": self.id,
            "bill_id": self.bill_id,
            "month": self.month,
            "year": self.year,
            "amount_paid": float(self.amount_paid or 0),
            "paid": bool(self.paid),
            "paid_date": self.paid_date.isoformat() if self.paid_date else None,
            "notes": self.notes,
            "deducted_amount": float(self.deducted_amount or 0),
            "skip_deduction": self.skip_deduction,
            "deducts": self.deducts(bill),
        }


class Income(db.Model):
    __tablename__ = "incomes"
    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(128), nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False)  # NET / take-home per paycheck
    frequency = db.Column(db.String(32), default="monthly")  # monthly, per_check, annual
    type = db.Column(db.String(32), default="salary")        # salary, side_income, dividend
    month = db.Column(db.Integer)
    year = db.Column(db.Integer)
    received_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Optional per-paycheck breakdown. When gross_amount is set, treat `amount`
    # as net (gross - all deductions). Used by Reports + Investments YTD math.
    # Per-paycheck dollar amounts, not annualized.
    gross_amount = db.Column(db.Numeric(12, 2))
    federal_tax = db.Column(db.Numeric(12, 2))
    state_tax = db.Column(db.Numeric(12, 2))
    fica = db.Column(db.Numeric(12, 2))
    retirement_401k_amount = db.Column(db.Numeric(12, 2))
    health_insurance = db.Column(db.Numeric(12, 2))
    other_deductions = db.Column(db.Numeric(12, 2))
    # Which 401k account this paycheck's deduction flows into. If null, the
    # contribution is counted in totals but not attributed to a specific account.
    paycheck_retirement_account_id = db.Column(db.Integer,
                                               db.ForeignKey("retirement_401k.id", ondelete="SET NULL"))

    # Employment span for this income source. When changing jobs, set end_date on
    # the old one (and start_date on the new). Reports/forecasts only count income
    # during its active window, but historical rows stay for YTD/lifetime totals.
    start_date = db.Column(db.Date)   # when this income began (null = unbounded past)
    end_date = db.Column(db.Date)     # when it ended (null = ongoing)

    events = db.relationship("IncomeEvent", backref="income", cascade="all, delete-orphan",
                             order_by="IncomeEvent.occurred_on.desc()")

    def to_dict(self):
        return {
            "id": self.id,
            "source": self.source,
            "amount": float(self.amount or 0),
            "frequency": self.frequency,
            "type": self.type,
            "month": self.month,
            "year": self.year,
            "received_at": self.received_at.isoformat() if self.received_at else None,
            "gross_amount": float(self.gross_amount) if self.gross_amount is not None else None,
            "federal_tax": float(self.federal_tax) if self.federal_tax is not None else None,
            "state_tax": float(self.state_tax) if self.state_tax is not None else None,
            "fica": float(self.fica) if self.fica is not None else None,
            "retirement_401k_amount": float(self.retirement_401k_amount) if self.retirement_401k_amount is not None else None,
            "health_insurance": float(self.health_insurance) if self.health_insurance is not None else None,
            "other_deductions": float(self.other_deductions) if self.other_deductions is not None else None,
            "paycheck_retirement_account_id": self.paycheck_retirement_account_id,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
        }


class IncomeEvent(db.Model):
    """One-off income hits — bonuses, commissions, irregular side-income payments."""
    __tablename__ = "income_events"
    id = db.Column(db.Integer, primary_key=True)
    income_id = db.Column(db.Integer, db.ForeignKey("incomes.id", ondelete="CASCADE"), nullable=False)
    occurred_on = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)  # NET / take-home
    gross_amount = db.Column(db.Numeric(12, 2))                       # optional pre-tax amount
    kind = db.Column(db.String(32), default="payment")  # bonus, commission, payment, tip, other
    note = db.Column(db.Text)
    # Set when this event's money is already inside an imported paycheck's net
    # (a bonus paid on the same check). Linked events still show in the income
    # history but are excluded from month totals so nothing counts twice.
    paycheck_id = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "income_id": self.income_id,
            "occurred_on": self.occurred_on.isoformat() if self.occurred_on else None,
            "amount": float(self.amount or 0),
            "gross_amount": float(self.gross_amount) if self.gross_amount is not None else None,
            "kind": self.kind,
            "note": self.note,
            "paycheck_id": self.paycheck_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Paycheck(db.Model):
    """One actual paycheck, as printed on a stub.

    Recurring `Income` rows model a *rate* over an employment span, which can't
    know when checks really land — a job change or a mid-month start makes the
    derived month wrong. A Paycheck is ground truth for the month it lands in,
    and analytics prefers it over the estimate for any employer that has one."""
    __tablename__ = "paychecks"
    id = db.Column(db.Integer, primary_key=True)
    income_id = db.Column(db.Integer, db.ForeignKey("incomes.id", ondelete="SET NULL"))
    employer = db.Column(db.String(160))
    check_date = db.Column(db.Date, nullable=False, index=True)
    period_start = db.Column(db.Date)
    period_end = db.Column(db.Date)

    gross = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    net = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    # The bonus/irregular slice of gross, when the stub broke it out separately.
    bonus_gross = db.Column(db.Numeric(12, 2))

    federal_tax = db.Column(db.Numeric(12, 2))
    state_tax = db.Column(db.Numeric(12, 2))      # includes local/county withholding
    fica = db.Column(db.Numeric(12, 2))           # social security + medicare
    retirement_401k = db.Column(db.Numeric(12, 2))
    health_insurance = db.Column(db.Numeric(12, 2))
    other_deductions = db.Column(db.Numeric(12, 2))

    source_file = db.Column(db.String(255))
    note = db.Column(db.Text)
    # employer|check_date|net — stops the same stub importing twice.
    fingerprint = db.Column(db.String(64), unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        def f(v):
            return float(v) if v is not None else None
        return {
            "id": self.id,
            "income_id": self.income_id,
            "employer": self.employer,
            "check_date": self.check_date.isoformat() if self.check_date else None,
            "period_start": self.period_start.isoformat() if self.period_start else None,
            "period_end": self.period_end.isoformat() if self.period_end else None,
            "gross": float(self.gross or 0),
            "net": float(self.net or 0),
            "bonus_gross": f(self.bonus_gross),
            "federal_tax": f(self.federal_tax),
            "state_tax": f(self.state_tax),
            "fica": f(self.fica),
            "retirement_401k": f(self.retirement_401k),
            "health_insurance": f(self.health_insurance),
            "other_deductions": f(self.other_deductions),
            "source_file": self.source_file,
            "note": self.note,
        }


class Debt(db.Model):
    __tablename__ = "debts"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    debt_amount = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    asset_value = db.Column(db.Numeric(14, 2), default=0)
    interest_rate = db.Column(db.Numeric(6, 3), default=0)
    monthly_payment = db.Column(db.Numeric(12, 2), default=0)
    category = db.Column(db.String(32), default="other")  # mortgage, auto, student, credit_card, other
    # Optional bundle label ("Dept of Ed — mine", "Dept of Ed — partner").
    # Debts sharing a group_name collapse into one expandable row in the UI;
    # payoff math still runs per-loan so avalanche ordering stays exact.
    group_name = db.Column(db.String(128))
    notes = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "debt_amount": float(self.debt_amount or 0),
            "asset_value": float(self.asset_value or 0),
            "interest_rate": float(self.interest_rate or 0),
            "monthly_payment": float(self.monthly_payment or 0),
            "category": self.category,
            "group_name": self.group_name,
            "notes": self.notes,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SavingsAccount(db.Model):
    __tablename__ = "savings_accounts"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    balance = db.Column(db.Numeric(14, 2), default=0)
    bucket = db.Column(db.String(32), default="cash")  # cash, savings_bucket
    # Business account: tracked + visible, but kept OUT of personal net worth,
    # the cash total, the cash-flow forecast, and the bill-pay picker.
    is_business = db.Column(db.Boolean, default=False)
    # Manual display order for the Cash & savings table. Lower sorts first; new
    # accounts land at the bottom rather than jumping the list alphabetically.
    sort_order = db.Column(db.Integer, default=0)
    notes = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "balance": float(self.balance or 0),
            "bucket": self.bucket,
            "is_business": bool(self.is_business),
            "sort_order": self.sort_order or 0,
            "notes": self.notes,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class InvestmentAccount(db.Model):
    __tablename__ = "investment_accounts"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    asset_type = db.Column(db.String(32), default="stock")  # stock, reit, managed, cash_eq, real_estate
    symbol = db.Column(db.String(32))
    balance = db.Column(db.Numeric(14, 2), default=0)
    notes = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "asset_type": self.asset_type,
            "symbol": self.symbol,
            "balance": float(self.balance or 0),
            "notes": self.notes,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Retirement401k(db.Model):
    __tablename__ = "retirement_401k"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False, default="401k")
    balance = db.Column(db.Numeric(14, 2), default=0)
    contribution_pct = db.Column(db.Numeric(6, 3), default=0)
    employer_match_pct = db.Column(db.Numeric(6, 3), default=0)
    projected_growth_pct = db.Column(db.Numeric(6, 3), default=7)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "balance": float(self.balance or 0),
            "contribution_pct": float(self.contribution_pct or 0),
            "employer_match_pct": float(self.employer_match_pct or 0),
            "projected_growth_pct": float(self.projected_growth_pct or 0),
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class InvestmentContribution(db.Model):
    """A deposit/contribution into a retirement account or investment account.

    Polymorphic FK: exactly one of retirement_id or investment_id is set,
    indicated by account_kind. Enforced in the route layer.
    """
    __tablename__ = "investment_contributions"
    id = db.Column(db.Integer, primary_key=True)
    account_kind = db.Column(db.String(16), nullable=False)  # "retirement_401k" | "investment"
    retirement_id = db.Column(db.Integer, db.ForeignKey("retirement_401k.id", ondelete="CASCADE"))
    investment_id = db.Column(db.Integer, db.ForeignKey("investment_accounts.id", ondelete="CASCADE"))
    occurred_on = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "account_kind": self.account_kind,
            "account_id": self.retirement_id if self.account_kind == "retirement_401k" else self.investment_id,
            "occurred_on": self.occurred_on.isoformat() if self.occurred_on else None,
            "amount": float(self.amount or 0),
            "note": self.note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class GiveEvent(db.Model):
    """A charitable gift / tithe / donation. Optional photo attached on disk."""
    __tablename__ = "give_events"
    id = db.Column(db.Integer, primary_key=True)
    occurred_on = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    recipient = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(32), default="other")  # church, charity, person, missions, other
    note = db.Column(db.Text)
    photo_path = db.Column(db.String(512))  # relative path under data/give_photos
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "occurred_on": self.occurred_on.isoformat() if self.occurred_on else None,
            "amount": float(self.amount or 0),
            "recipient": self.recipient,
            "category": self.category,
            "note": self.note,
            "has_photo": bool(self.photo_path),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class OwedToMe(db.Model):
    __tablename__ = "owed_to_me"
    id = db.Column(db.Integer, primary_key=True)
    person = db.Column(db.String(128), nullable=False)
    amount = db.Column(db.Numeric(12, 2), default=0)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "person": self.person,
            "amount": float(self.amount or 0),
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class FicoEntry(db.Model):
    __tablename__ = "fico_entries"
    id = db.Column(db.Integer, primary_key=True)
    score = db.Column(db.Integer, nullable=False)
    model_name = db.Column(db.String(128), default="FICO Score 8")
    recorded_on = db.Column(db.Date, nullable=False)
    notes = db.Column(db.Text)

    def to_dict(self):
        return {
            "id": self.id,
            "score": self.score,
            "model_name": self.model_name,
            "recorded_on": self.recorded_on.isoformat() if self.recorded_on else None,
            "notes": self.notes,
        }


class ImportedTransaction(db.Model):
    __tablename__ = "imported_transactions"
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    description = db.Column(db.Text)
    amount = db.Column(db.Numeric(12, 2), nullable=False)
    category = db.Column(db.String(64))
    type = db.Column(db.String(16))  # debit, credit
    source_file = db.Column(db.String(255))
    matched_bill_id = db.Column(db.Integer, db.ForeignKey("bills.id"))
    confirmed = db.Column(db.Boolean, default=False)
    fingerprint = db.Column(db.String(64), unique=True)  # for dedupe
    # Which account this statement line belongs to — needed to reconcile a
    # balance against the right account.
    account_id = db.Column(db.Integer, db.ForeignKey("savings_accounts.id", ondelete="SET NULL"))
    # The running balance the bank printed after this line, when the statement
    # carries one (Chase CSVs do). This is the bank's own truth, which makes it
    # the anchor for reconciliation.
    balance_after = db.Column(db.Numeric(14, 2))

    def to_dict(self):
        return {
            "id": self.id,
            "date": self.date.isoformat() if self.date else None,
            "description": self.description,
            "amount": float(self.amount or 0),
            "category": self.category,
            "type": self.type,
            "source_file": self.source_file,
            "matched_bill_id": self.matched_bill_id,
            "confirmed": bool(self.confirmed),
            "account_id": self.account_id,
            "balance_after": float(self.balance_after) if self.balance_after is not None else None,
        }


class UtilityReading(db.Model):
    """A single utility statement's usage + cost, for trending consumption over
    time independent of price. e.g. electric: 920 kWh for $134.20.

    Optionally linked to a Bill so a reading can be tied to the biller.
    """
    __tablename__ = "utility_readings"
    id = db.Column(db.Integer, primary_key=True)
    utility_type = db.Column(db.String(32), nullable=False, default="electric")  # electric, water, gas, internet, trash, sewer, other
    bill_id = db.Column(db.Integer, db.ForeignKey("bills.id", ondelete="SET NULL"))
    # Service period the statement covers.
    period_start = db.Column(db.Date)
    period_end = db.Column(db.Date, nullable=False)   # used as the trend x-axis anchor
    usage = db.Column(db.Numeric(12, 3))              # quantity consumed (nullable — some bills are flat)
    unit = db.Column(db.String(16), default="kWh")    # kWh, gal, CCF, therm, GB, etc.
    cost = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    notes = db.Column(db.Text)
    source_file = db.Column(db.String(255))           # set when imported from CSV
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        usage = float(self.usage) if self.usage is not None else None
        cost = float(self.cost or 0)
        return {
            "id": self.id,
            "utility_type": self.utility_type,
            "bill_id": self.bill_id,
            "period_start": self.period_start.isoformat() if self.period_start else None,
            "period_end": self.period_end.isoformat() if self.period_end else None,
            "usage": usage,
            "unit": self.unit,
            "cost": cost,
            "cost_per_unit": round(cost / usage, 4) if usage else None,
            "notes": self.notes,
            "source_file": self.source_file,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AIConversation(db.Model):
    __tablename__ = "ai_conversations"
    id = db.Column(db.Integer, primary_key=True)
    question = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "question": self.question,
            "answer": self.answer,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class BudgetAllocation(db.Model):
    __tablename__ = "budget_allocations"
    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(128), nullable=False, default="default")  # e.g. "Me", "Partner"
    live_pct = db.Column(db.Numeric(5, 2), default=70)
    invest_pct = db.Column(db.Numeric(5, 2), default=10)
    save_pct = db.Column(db.Numeric(5, 2), default=10)
    debt_pct = db.Column(db.Numeric(5, 2), default=10)
    give_pct = db.Column(db.Numeric(5, 2), default=0)

    __table_args__ = (db.UniqueConstraint("source", name="uq_budget_source"),)

    def to_dict(self):
        return {
            "id": self.id,
            "source": self.source,
            "live_pct": float(self.live_pct or 0),
            "invest_pct": float(self.invest_pct or 0),
            "save_pct": float(self.save_pct or 0),
            "debt_pct": float(self.debt_pct or 0),
            "give_pct": float(self.give_pct or 0),
        }


class AnnualIncome(db.Model):
    """Gross income per calendar year, for long-horizon trending (years on X,
    dollars on Y).

    `gross_amount` is the account owner's income; `partner_amount` is a second
    earner's, nullable because not every year is tracked for them. Combined is
    derived. Both are labelled at display time from the `income_self_label` /
    `income_partner_label` settings, so the schema stays household-agnostic.
    Separate from the Income table, which models current recurring paychecks."""
    __tablename__ = "annual_income"
    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, unique=True)
    gross_amount = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    partner_amount = db.Column(db.Numeric(14, 2))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        gross = float(self.gross_amount or 0)
        partner = float(self.partner_amount) if self.partner_amount is not None else None
        return {
            "id": self.id,
            "year": self.year,
            "gross_amount": gross,
            "partner_amount": partner,
            "combined_amount": gross + (partner or 0),
            "notes": self.notes,
        }


class NetWorthSnapshot(db.Model):
    """A point-in-time net-worth capture, one row per month (upserted), so we can
    trend wealth over time — balances are otherwise only ever 'current'."""
    __tablename__ = "networth_snapshots"
    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False)
    month = db.Column(db.Integer, nullable=False)
    taken_on = db.Column(db.Date)
    cash = db.Column(db.Numeric(14, 2), default=0)
    investments = db.Column(db.Numeric(14, 2), default=0)
    retirement = db.Column(db.Numeric(14, 2), default=0)
    asset_value = db.Column(db.Numeric(14, 2), default=0)
    debt = db.Column(db.Numeric(14, 2), default=0)
    net_worth = db.Column(db.Numeric(14, 2), default=0)

    __table_args__ = (db.UniqueConstraint("year", "month", name="uq_networth_period"),)

    def to_dict(self):
        return {
            "year": self.year,
            "month": self.month,
            "taken_on": self.taken_on.isoformat() if self.taken_on else None,
            "cash": float(self.cash or 0),
            "investments": float(self.investments or 0),
            "retirement": float(self.retirement or 0),
            "asset_value": float(self.asset_value or 0),
            "debt": float(self.debt or 0),
            "net_worth": float(self.net_worth or 0),
        }


class Project(db.Model):
    """A side-business project for a customer, billed at an hourly rate."""
    __tablename__ = "projects"
    id = db.Column(db.Integer, primary_key=True)
    customer = db.Column(db.String(160))
    name = db.Column(db.String(160), nullable=False)
    hourly_rate = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    is_active = db.Column(db.Boolean, default=True)
    notes = db.Column(db.Text)
    # When set, this project mirrors an engagement in the Sales CRM and its work
    # entries are refreshed from there instead of being typed in by hand.
    crm_opportunity_id = db.Column(db.Integer)
    crm_synced_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    entries = db.relationship("WorkEntry", backref="project", cascade="all, delete-orphan",
                              order_by="WorkEntry.year.desc(), WorkEntry.month.desc()")

    def to_dict(self, with_totals=False):
        d = {
            "id": self.id,
            "customer": self.customer,
            "name": self.name,
            "hourly_rate": float(self.hourly_rate or 0),
            "is_active": bool(self.is_active),
            "notes": self.notes,
            "crm_opportunity_id": self.crm_opportunity_id,
            "crm_synced_at": self.crm_synced_at.isoformat() if self.crm_synced_at else None,
        }
        if with_totals:
            hours = sum(float(e.hours or 0) for e in self.entries)
            d.update({
                "total_hours": round(hours, 2),
                "total_billed": round(sum(e.effective_amount() for e in self.entries), 2),
                "uninvoiced": round(sum(e.effective_amount() for e in self.entries if not e.invoiced), 2),
                "unpaid": round(sum(e.effective_amount() for e in self.entries if not e.paid), 2),
                "entry_count": len(self.entries),
            })
        return d


class WorkEntry(db.Model):
    """A month's worth of work on a project — hours + what was done, for invoicing."""
    __tablename__ = "work_entries"
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    month = db.Column(db.Integer, nullable=False)
    hours = db.Column(db.Numeric(8, 2), nullable=False, default=0)
    note = db.Column(db.Text)
    invoiced = db.Column(db.Boolean, default=False)
    paid = db.Column(db.Boolean, default=False)
    # When a month is marked paid, we mirror it into an IncomeEvent so it counts
    # toward take-home. This links the two so we can update/remove it in sync.
    income_event_id = db.Column(db.Integer)
    # The billed total when it isn't simply hours x the project rate — a CRM
    # invoice can blend rates within one period (e.g. a discounted hour), which
    # hours x rate can't express without fudging the hours.
    amount_override = db.Column(db.Numeric(12, 2))
    # "manual" or "crm". CRM-sourced rows are overwritten on the next sync.
    source = db.Column(db.String(16), default="manual")
    # Which CRM record produced this row, e.g. "invoice:2". Lets a re-sync find
    # the row again even if its period shifts.
    crm_ref = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint("project_id", "year", "month", name="uq_work_period"),)

    def effective_amount(self):
        """What this month actually bills — the override when present, else the
        plain hours x project rate."""
        if self.amount_override is not None:
            return round(float(self.amount_override), 2)
        rate = float(self.project.hourly_rate or 0) if self.project else 0
        return round(float(self.hours or 0) * rate, 2)

    def to_dict(self):
        return {
            "id": self.id,
            "project_id": self.project_id,
            "year": self.year,
            "month": self.month,
            "hours": float(self.hours or 0),
            "note": self.note,
            "invoiced": bool(self.invoiced),
            "paid": bool(self.paid),
            "amount": self.effective_amount(),
            "amount_override": float(self.amount_override) if self.amount_override is not None else None,
            "source": self.source or "manual",
            "crm_ref": self.crm_ref,
            "logged_as_income": self.income_event_id is not None,
        }


class BusinessExpense(db.Model):
    """A side-business expense (software, hardware, mileage, fees...) with an
    optional receipt file stored under DATA_DIR/receipts. project_id and
    contractor_id are soft references (no FK) so deleting either parent leaves
    the expense record intact."""
    __tablename__ = "business_expenses"
    id = db.Column(db.Integer, primary_key=True)
    incurred_on = db.Column(db.Date, nullable=False)
    vendor = db.Column(db.String(160))
    description = db.Column(db.Text)
    amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    category = db.Column(db.String(64), default="Other")
    project_id = db.Column(db.Integer)          # optional link to a Project
    contractor_id = db.Column(db.Integer)       # optional link to a Contractor
    receipt_path = db.Column(db.String(255))    # filename under DATA_DIR/receipts
    receipt_mime = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, project_names: dict | None = None, contractor_names: dict | None = None):
        return {
            "id": self.id,
            "incurred_on": self.incurred_on.isoformat() if self.incurred_on else None,
            "vendor": self.vendor,
            "description": self.description,
            "amount": float(self.amount or 0),
            "category": self.category,
            "project_id": self.project_id,
            "project_name": (project_names or {}).get(self.project_id),
            "contractor_id": self.contractor_id,
            "contractor_name": (contractor_names or {}).get(self.contractor_id),
            "has_receipt": self.receipt_path is not None,
            "receipt_mime": self.receipt_mime,
        }


class Contractor(db.Model):
    """A subcontractor the side business pays. Tracks the compliance basics —
    W-9 on file, and (via linked BusinessExpense payments) whether the year's
    total crosses the 1099-NEC reporting threshold."""
    __tablename__ = "contractors"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    contact = db.Column(db.String(255))         # email / phone, freeform
    notes = db.Column(db.Text)
    w9_on_file = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "contact": self.contact,
            "notes": self.notes,
            "w9_on_file": bool(self.w9_on_file),
            "is_active": bool(self.is_active),
        }


class AppSetting(db.Model):
    __tablename__ = "app_settings"
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text)

    def to_dict(self):
        return {"key": self.key, "value": self.value}


class SpendingCategory(db.Model):
    """User-editable list of spending categories used to label imported
    transactions and drive the spending charts. Seeded with sensible defaults
    on first use; the user can rename, recolor, add, or archive them."""
    __tablename__ = "spending_categories"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)
    color = db.Column(db.String(16))          # hex like "#3A5FB8"; optional
    sort_order = db.Column(db.Integer, default=0)
    archived = db.Column(db.Boolean, default=False)
    # Excluded from the spending chart/total by default (still a usable category,
    # and its amount still shows in the breakdown list) — e.g. Transfer.
    chart_hidden = db.Column(db.Boolean, default=False)
    # Optional monthly spending budget. Null = not budgeted (untracked).
    monthly_budget = db.Column(db.Numeric(12, 2))
    # Reimbursable (e.g. Work Expense): inflows categorized here are refunds of
    # the outflows, so spending math counts the NET, not the gross outflow.
    reimbursable = db.Column(db.Boolean, default=False)
    # Inflow-alias category (e.g. Work Reimbursement): deposits categorized here
    # offset the spending of the category this points at (e.g. Work Expense).
    offset_category_id = db.Column(db.Integer)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "sort_order": self.sort_order or 0,
            "archived": bool(self.archived),
            "chart_hidden": bool(self.chart_hidden),
            "monthly_budget": float(self.monthly_budget) if self.monthly_budget is not None else None,
            "reimbursable": bool(self.reimbursable),
            "offset_category_id": self.offset_category_id,
        }


class MerchantRule(db.Model):
    """A learned 'if a transaction description contains <keyword>, categorize it
    as <category>' rule, optionally gated by amount. Keyword is stored lowercase;
    matching is a case-insensitive substring test. Amount bounds are compared
    against the spend magnitude (abs of the amount):
      - min_amount set  -> matches when amount  > min_amount   ("over $X")
      - max_amount set  -> matches when amount <= max_amount   ("$X or under")
    So a merchant can split by size, e.g. soccer over $20 = Hobbies, $20-or-under
    = Dining (the food stand). Keyword is intentionally NOT unique so one merchant
    can carry several amount-banded rules."""
    __tablename__ = "merchant_rules"
    id = db.Column(db.Integer, primary_key=True)
    keyword = db.Column(db.String(128), nullable=False)
    category = db.Column(db.String(64), nullable=False)
    min_amount = db.Column(db.Numeric(12, 2))   # "over this much"
    max_amount = db.Column(db.Numeric(12, 2))   # "this much or under"
    # Co-occurrence gate: rule only applies when another transaction on the SAME
    # day contains this keyword (e.g. Walmart counts as Groceries only on a day
    # you also shopped at Aldi). Null = no co-occurrence condition.
    same_day_keyword = db.Column(db.String(128))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "keyword": self.keyword,
            "category": self.category,
            "min_amount": float(self.min_amount) if self.min_amount is not None else None,
            "max_amount": float(self.max_amount) if self.max_amount is not None else None,
            "same_day_keyword": self.same_day_keyword,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class EnergyWasteEvent(db.Model):
    """An energy 'waste event' pushed in from a sibling app (the Home Automation
    dashboard) — a span of time during which a device drew power it arguably
    shouldn't have, with the wasted energy (kWh) and its estimated dollar cost.

    Deliberately lightweight and standalone: it is NOT a bill, payment, or
    spending transaction, so it never feeds net worth, cashflow, or budgets. It
    is a read-mostly ledger the user (and Claude) can reconcile against monthly
    utility bills. Dropping this one table fully reverses the integration.
    """
    __tablename__ = "energy_waste_events"
    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(64), nullable=False, default="home-automation")  # which app pushed it
    device_id = db.Column(db.String(64))          # opaque device identifier from the source app
    period_start = db.Column(db.DateTime, nullable=False)  # when the waste span began (UTC)
    period_end = db.Column(db.DateTime, nullable=False)    # when it ended (UTC)
    kwh = db.Column(db.Numeric(14, 4), nullable=False, default=0)   # wasted energy
    cost = db.Column(db.Numeric(12, 4), nullable=False, default=0)  # estimated dollar cost of the waste
    created_at = db.Column(db.DateTime, default=datetime.utcnow)    # when Hearth received it

    def to_dict(self):
        return {
            "id": self.id,
            "source": self.source,
            "device_id": self.device_id,
            "start": self.period_start.isoformat() if self.period_start else None,
            "end": self.period_end.isoformat() if self.period_end else None,
            "kwh": float(self.kwh) if self.kwh is not None else None,
            "cost": float(self.cost) if self.cost is not None else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
