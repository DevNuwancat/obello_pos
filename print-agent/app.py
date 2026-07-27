"""
POS Receipt Printer + Cash Drawer Agent
Runs locally on each till computer to handle thermal printer + cash drawer via ESC/POS.
Exposes a simple HTTP API so the Vue app can trigger printing & drawer opening.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from escpos.printer import Usb
from escpos.constants import PAPER_FULL_CUT
import uvicorn
import qrcode
from pathlib import Path
from PIL import Image

# ─────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────
SHOP_NAME = "Obello"
SHOP_TAGLINE = "Style for every story."
SHOP_ADDRESS = "Marapana-South, Ratnapura."
SHOP_PHONE = "075 314 9175"
SHOP_EMAIL = "obelloclothing@gmail.com"
SHOP_SOCIAL_HANDLE = "@obelloclothing"
RECEIPT_WIDTH_CHARS = 32  # 58mm paper
PORT = 8899

# Path to the logo file (frontend/public/logo.png, relative to this script)
LOGO_PATH = Path(__file__).resolve().parent.parent / "frontend" / "public" / "logo.png"

# ─────────────────────────────────────────────────────────────────────
# DATA MODELS (shape of incoming JSON from the Vue app)
# ─────────────────────────────────────────────────────────────────────
class ReceiptItem(BaseModel):
    product_name: str
    quantity: float
    unit_price: float

class PrintReceiptRequest(BaseModel):
    invoice_no: str
    items: List[ReceiptItem]
    payment_method: str
    subtotal: float
    discount_amount: float
    total: float
    amount_paid: float
    balance: float
    is_cash_sale: bool  # True = cash payment, should open drawer

class OpenDrawerRequest(BaseModel):
    pass  # No payload needed, just trigger the drawer

# ─────────────────────────────────────────────────────────────────────
# FASTAPI APP
# ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="Obello POS Print Agent", version="1.0.0")

# Allow requests from the Vue app (localhost:5173 during dev, or any origin in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────
# PRINTER & DRAWER FUNCTIONS
# ─────────────────────────────────────────────────────────────────────

def connect_receipt_printer() -> Usb:
    """
    Connect to the USB thermal printer.
    Uses vendor_id=0x0483, product_id=0x5720 (MHT-W5801 ESC/POS printer).
    Profile="NT-5890K" defines the paper width so text centering works.
    """
    return Usb(0x0483, 0x5720, profile="NT-5890K")

def open_cash_drawer_only():
    """
    Pop the cash drawer without printing a receipt.
    Used when cashier accepts cash but receipt printing is off.
    """
    try:
        printer = connect_receipt_printer()
        printer.cashdraw(2)
        printer.close()
    except Exception as e:
        raise Exception(f"Could not open cash drawer: {e}")

# ─────────────────────────────────────────────────────────────────────
# TEXT LAYOUT HELPERS
# All lines must fit inside RECEIPT_WIDTH_CHARS (32) or they wrap ugly.
# ─────────────────────────────────────────────────────────────────────

def money(n: float) -> str:
    """Format a number with thousands separator: 2100.0 -> '2,100.00'"""
    return f"{n:,.2f}"

def two_col(left: str, right: str, width: int = RECEIPT_WIDTH_CHARS) -> str:
    """
    Lay text out as 'left .......... right', right-aligned,
    truncating left if it would push right off the line.
    """
    space = width - len(left) - len(right)
    if space < 1:
        # Not enough room — trim the left label so it still fits
        left = left[: max(0, width - len(right) - 1)]
        space = width - len(left) - len(right)
    return left + (" " * space) + right

def center_line(text: str, width: int = RECEIPT_WIDTH_CHARS) -> str:
    """Manually center a line of text (used when printer.set align isn't reliable)."""
    if len(text) >= width:
        return text
    pad = (width - len(text)) // 2
    return (" " * pad) + text


def print_receipt_to_printer(
    invoice_no: str,
    items: List[ReceiptItem],
    payment_method: str,
    subtotal: float,
    discount_amount: float,
    total: float,
    amount_paid: float,
    balance: float,
    open_cash_drawer: bool = False,
):
    """
    Format and print a receipt to the thermal printer, matching obello's design.
    Optionally opens the cash drawer before/during printing.
    """
    try:
        printer = connect_receipt_printer()

        # Open drawer if this is a cash sale
        if open_cash_drawer:
            printer.cashdraw(2)

        divider = "-" * RECEIPT_WIDTH_CHARS

        # ─── HEADER: LOGO IMAGE ───
        if LOGO_PATH.exists():
            try:
                logo = Image.open(LOGO_PATH).convert("RGBA")
                # Flatten transparency onto white (thermal printers can't handle alpha)
                bg = Image.new("RGBA", logo.size, "WHITE")
                bg.paste(logo, (0, 0), logo)
                logo = bg.convert("L")  # grayscale, escpos will dither/threshold it

                # Scale to fit 58mm paper width, keep aspect ratio
                target_width = 300
                ratio = target_width / logo.width
                logo = logo.resize((target_width, int(logo.height * ratio)))

                printer.set(align='center')
                printer.image(logo)
                # image() doesn't reliably leave the cursor at column 0 on some
                # printers — force a fresh line before any text follows.
                printer.ln(1)
            except Exception:
                printer.set(align='center', font='a', width=2, height=2, bold=True)
                printer.text(f"{SHOP_NAME}\n")
        else:
            printer.set(align='center', font='a', width=2, height=2, bold=True)
            printer.text(f"{SHOP_NAME}\n")

        # Tagline — centered manually + left align mode so nothing auto-wraps oddly
        printer.set(align='left', font='a', width=1, height=1, bold=False)
        printer.text(center_line(SHOP_TAGLINE) + "\n")
        printer.text("\n")

        # ─── SHOP CONTACT INFO (plain text — thermal printers can't render emoji) ───
        printer.set(align='left', font='a', width=1, height=1)
        printer.text(center_line(SHOP_ADDRESS) + "\n")
        printer.text(center_line(f"Tel: {SHOP_PHONE}") + "\n")
        printer.text(center_line(SHOP_EMAIL) + "\n")
        printer.text(divider + "\n")

        # ─── INVOICE & DATE/TIME (each on its own line — never wraps) ───
        now = datetime.now()
        printer.text(f"Invoice: {invoice_no}\n")
        printer.text(two_col(f"Date: {now.strftime('%Y-%m-%d')}", now.strftime('%H:%M')) + "\n")
        printer.text(f"Payment: {payment_method.title()}\n")
        printer.text(divider + "\n")

        # ─── LINE ITEMS ───
        for item in items:
            printer.set(bold=True)
            printer.text(f"{item.product_name}\n")
            printer.set(bold=False)

            line_total = item.quantity * item.unit_price
            qty = item.quantity
            qty_str = f"{qty:g}" if qty != int(qty) else f"{int(qty)}"
            left = f"  {qty_str} x Rs.{money(item.unit_price)}"
            right = money(line_total)
            printer.text(two_col(left, right) + "\n")

        printer.text(divider + "\n")

        # ─── TOTALS SECTION ───
        printer.text(two_col("Sub Total", f"Rs.{money(subtotal)}") + "\n")

        if discount_amount > 0:
            printer.text(two_col("Discount", f"-Rs.{money(discount_amount)}") + "\n")

        printer.set(bold=True)
        printer.text(two_col("TOTAL", f"Rs.{money(total)}") + "\n")
        printer.set(bold=False)

        printer.text(divider + "\n")
        printer.text(two_col("Paid", f"Rs.{money(amount_paid)}") + "\n")
        printer.text(two_col("Balance", f"Rs.{money(balance)}") + "\n")

        # ─── SAVINGS BOX ───
        if discount_amount > 0:
            printer.text("\n")
            printer.set(bold=True)
            printer.text(center_line(f"* You saved Rs.{money(discount_amount)} *") + "\n")
            printer.set(bold=False)

        printer.text("\n")

        # ─── FOOTER ───
        printer.text(center_line("7-Day exchange policy") + "\n")
        printer.text(center_line("Receipt & tags required") + "\n")
        printer.set(bold=True)
        printer.text(center_line("Welcome to the obello family!") + "\n")
        printer.set(bold=False)
        printer.text("\n")

        # ─── SOCIAL MEDIA ───
        printer.text(center_line("Tag us to be featured:") + "\n")
        printer.text(center_line(SHOP_SOCIAL_HANDLE) + "\n")
        printer.text("\n")

        # ─── QR CODE ───
        # Generate QR code with invoice info for receipt tracking.
        # image_factory=PilImage forces a real Pillow image (qrcode's default
        # PyPNGImage isn't compatible with escpos's image() method, which is
        # why this silently failed before).
        try:
            from qrcode.image.pil import PilImage
            qr_data = f"Invoice:{invoice_no}|Total:{money(total)}"
            qr = qrcode.QRCode(version=1, box_size=3, border=2)
            qr.add_data(qr_data)
            qr.make(fit=True)
            qr_img = qr.make_image(image_factory=PilImage, fill_color="black", back_color="white").convert("L")
            printer.set(align='center')
            printer.image(qr_img)
            printer.ln(1)
        except Exception:
            printer.set(align='left')
            printer.text(center_line(f"Ref: {invoice_no}") + "\n")

        # ─── CUT PAPER ───
        printer.text("\n")
        printer._raw(PAPER_FULL_CUT)

        printer.close()
    except Exception as e:
        raise Exception(f"Print failed: {e}")

# ─────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Health check endpoint — confirm the agent is running."""
    return {"status": "ok", "service": "Obello POS Print Agent"}

@app.post("/print-receipt")
def print_receipt(req: PrintReceiptRequest):
    """
    Print a receipt and optionally open the cash drawer.
    Called from POSView.vue after checkout succeeds.
    """
    try:
        print_receipt_to_printer(
            invoice_no=req.invoice_no,
            items=req.items,
            payment_method=req.payment_method,
            subtotal=req.subtotal,
            discount_amount=req.discount_amount,
            total=req.total,
            amount_paid=req.amount_paid,
            balance=req.balance,
            open_cash_drawer=req.is_cash_sale,
        )
        return {"status": "success", "message": "Receipt printed"}
    except Exception as e:
        print(f"Error printing receipt: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/open-drawer")
def open_drawer(req: OpenDrawerRequest):
    """
    Open the cash drawer without printing.
    Useful for "No Sale" button or manual drawer open.
    """
    try:
        open_cash_drawer_only()
        return {"status": "success", "message": "Cash drawer opened"}
    except Exception as e:
        print(f"Error opening cash drawer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────────────
# RUN
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"🖨️  Obello POS Print Agent starting on http://localhost:{PORT}")
    print("To stop, press Ctrl+C")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
