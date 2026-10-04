"""Render a freelance invoice to PDF using PyMuPDF's HTML Story engine."""
from __future__ import annotations
import io
from html import escape


def _lines(text: str) -> str:
    return "<br/>".join(escape(ln) for ln in (text or "").splitlines() if ln.strip())


def _html_to_pdf(html: str) -> bytes:
    import fitz  # PyMuPDF
    story = fitz.Story(html=html)
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    more = 1
    while more:
        dev = writer.begin_page(fitz.paper_rect("letter"))
        more, _ = story.place(fitz.Rect(48, 48, 564, 744))
        story.draw(dev)
        writer.end_page()
    writer.close()
    return buf.getvalue()


def render_invoice(ctx: dict) -> bytes:
    """ctx: {number, date, due, from_text, bill_to, items:[{desc,note,hours,rate,amount}], total, notes}"""
    rows = ""
    for li in ctx["items"]:
        note = f'<div class="note">{escape(li["note"])}</div>' if li.get("note") else ""
        rows += (
            f'<tr><td>{escape(li["desc"])}{note}</td>'
            f'<td class="num">{li["hours"]:g}</td>'
            f'<td class="num">${li["rate"]:,.2f}</td>'
            f'<td class="num">${li["amount"]:,.2f}</td></tr>'
        )
    notes_html = (
        f'<div class="notes"><div class="label">Notes</div>{_lines(ctx.get("notes") or "")}</div>'
        if ctx.get("notes") else ""
    )

    subtotal = ctx.get("subtotal", ctx["total"])
    discount = ctx.get("discount", 0) or 0
    tax_rate = ctx.get("tax_rate", 0) or 0
    tax_amount = ctx.get("tax_amount", 0) or 0
    total = ctx.get("total", subtotal)

    paid_stamp = (
        '<div style="display:inline-block; border:2px solid #2e9e6b; color:#2e9e6b; '
        'padding:3px 14px; font-weight:bold; letter-spacing:3px; border-radius:4px; margin-top:10px;">PAID</div>'
        if ctx.get("paid") else ""
    )

    def _trow(label, val, bold=False, neg=False):
        st = " font-weight:bold; font-size:16px;" if bold else " color:#777;"
        pad = "7px 8px" if bold else "2px 8px"
        return (f'<tr><td style="border:none;"></td>'
                f'<td style="border:none; text-align:right;{st} padding:{pad};">{label}</td>'
                f'<td style="border:none; text-align:right; font-family:monospace;{st} width:100px;">'
                f'{"-" if neg else ""}${val:,.2f}</td></tr>')

    rows_t = _trow("Subtotal", subtotal)
    if discount > 0:
        rows_t += _trow("Discount", discount, neg=True)
    if tax_amount > 0:
        rows_t += _trow(f"Tax ({tax_rate:g}%)", tax_amount)
    rows_t += _trow("Total due", total, bold=True)
    totals_table = f'<table style="width:100%; border-collapse:collapse; margin-top:14px;">{rows_t}</table>'

    pay_html = (
        f'<div class="notes"><div class="label">Payment</div>{_lines(ctx.get("pay_to") or "")}</div>'
        if ctx.get("pay_to") else ""
    )
    html = f"""<html><head><style>
      body {{ font-family: sans-serif; color: #1b1b1b; }}
      h1 {{ font-size: 30px; margin: 0; letter-spacing: 3px; color: #3A5FB8; }}
      .muted {{ color: #777; font-size: 11px; }}
      .right {{ text-align: right; }}
      .head td {{ border: none; padding: 0; vertical-align: top; font-size: 11px; }}
      .label {{ color: #999; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 3px; }}
      table.items {{ width: 100%; border-collapse: collapse; margin-top: 28px; font-size: 11px; }}
      table.items th {{ text-align: left; border-bottom: 2px solid #333; padding: 7px 4px;
                        font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #555; }}
      table.items td {{ padding: 9px 4px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }}
      .num {{ text-align: right; font-family: monospace; }}
      .note {{ color: #999; font-size: 10px; margin-top: 3px; }}
      .totalbox {{ margin-top: 14px; text-align: right; }}
      .total {{ font-size: 18px; font-weight: bold; }}
      .notes {{ margin-top: 30px; font-size: 11px; color: #555; }}
    </style></head><body>
      <table class="head" style="width:100%;"><tr>
        <td>{('<img src="' + ctx["logo"] + '" height="56"/><br/>') if ctx.get("logo") else ""}<b>{_lines(ctx["from_text"]) or "Your business"}</b></td>
        <td class="right"><h1>INVOICE</h1><div class="muted">#{escape(ctx["number"])}</div>{paid_stamp}</td>
      </tr></table>

      <table class="head" style="width:100%; margin-top:26px;"><tr>
        <td><div class="label">Bill to</div>{_lines(ctx["bill_to"]) or "&mdash;"}</td>
        <td class="right"><div class="label">Date</div>{escape(ctx["date"])}
          <div class="label" style="margin-top:8px;">Due</div>{escape(ctx["due"]) or "&mdash;"}</td>
      </tr></table>

      <table class="items">
        <tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr>
        {rows}
      </table>
      {totals_table}
      {notes_html}
      {pay_html}
    </body></html>"""
    return _html_to_pdf(html)
