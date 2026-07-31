# Obello POS Print Agent

A local HTTP microservice that handles thermal receipt printer + cash drawer control for your Obello POS app.

## Why?

Your POS app runs in Chrome (a web browser), and **browsers cannot** access USB devices like thermal printers or cash drawers for security reasons. This small agent runs quietly in the background on each till computer, exposing a simple HTTP API (`localhost:8899`) that the Vue app can call to print and open drawers.

## Setup for clients (Windows) — no Python needed

Your client does **not** need to install Python or use a terminal. Send them these 3 files (built by the "Build Print Agent (Windows)" GitHub Actions workflow — see [SETUP.md](SETUP.md) for how to trigger a build):

- `ObelloPrintAgent.exe`
- `install-autostart.bat`
- `uninstall-autostart.bat`

Steps for the client:
1. Put all 3 files in one folder, e.g. `C:\ObelloPrintAgent\`
2. Install the printer driver (Zadig) — see step 2 below. One-time only.
3. Double-click `install-autostart.bat`. This starts the agent immediately AND makes it auto-launch every time Windows boots. A small window will pop up and stay open (that's the agent running) — they can minimize it, never close it.
4. Test: open a browser and go to `http://localhost:8899/health` — should show `{"status":"ok",...}`

That's the whole setup. No terminal, no `pip install`, no Python.

## Setup for developers (running from source)

### 1. Install Python (if not already)
- **Mac**: `brew install python3`
- **Windows**: Download from https://www.python.org/downloads/ and install (check "Add Python to PATH")

### 2. Install the printer driver
This varies by OS and printer model.

**Mac (usually just works):**
```bash
brew install libusb
```

**Windows (the gotcha):**
Your ESC/POS printer ships with a standard USB driver that Windows recognizes. But `python-escpos` (the library we use) needs direct USB access. Use **Zadig** to swap the driver:
1. Download Zadig: https://zadig.akeo.ie/
2. Plug in your thermal printer
3. Open Zadig, find your printer in the dropdown (e.g. "NT-5890K" or similar)
4. Select "WinUSB" from the driver dropdown
5. Click "Install Driver"

This is one-time per computer.

### 3. Create a virtual environment
Keep the print agent's Python packages isolated from the rest of your system:

```bash
cd print-agent

# Create the venv (one-time)
python3 -m venv venv

# Activate it (do this every time before running the agent)
# Mac/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate
```

You should see `(venv)` at the start of your command prompt after activating.

### 4. Install dependencies
```bash
pip install -r requirements.txt
```

(Make sure the venv is activated from Step 3 first!)

### 5. Start the agent
```bash
python app.py
```

You'll see:
```
🖨️  Obello POS Print Agent starting on http://localhost:8899
```

**Leave this running in the background** (minimize the terminal window or use a task scheduler — see "Auto-start" below).

### 6. Test it
In another terminal:
```bash
# Check if the agent is healthy
curl http://localhost:8899/health

# Test opening the drawer (without a receipt)
curl -X POST http://localhost:8899/open-drawer \
  -H "Content-Type: application/json" \
  -d '{}'

# You should hear the cash drawer "kick" open.
```

## Auto-start (Optional)

So the agent starts automatically when the till boots:

**Mac (LaunchAgent):**
```bash
# Create a plist file (one-time)
# Replace /path/to with your actual obello_pos folder path
cat > ~/Library/LaunchAgents/com.obello.printAgent.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.obello.printAgent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/obello_pos/print-agent/venv/bin/python3</string>
        <string>/path/to/obello_pos/print-agent/app.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/print-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/print-agent.log</string>
</dict>
</plist>
EOF

# Load it
launchctl load ~/Library/LaunchAgents/com.obello.printAgent.plist
```

(Replace `/path/to/obello_pos` with the actual path.)

**Windows (Task Scheduler):**
1. Open Task Scheduler (Start → "Task Scheduler")
2. Create Basic Task → name it "Obello Print Agent"
3. Trigger: "At startup"
4. Action: "Start a program"
   - Program: `C:\path\to\obello_pos\print-agent\venv\Scripts\python.exe`
   - Arguments: `C:\path\to\obello_pos\print-agent\app.py`
5. Check "Run with highest privileges"
6. OK

## API Reference

### `POST /print-receipt`
Print a receipt and optionally open the drawer.

**Request body:**
```json
{
  "invoice_no": "INV-1726234500000",
  "items": [
    {
      "product_name": "Iced Latte",
      "quantity": 2,
      "unit_price": 550.00
    }
  ],
  "payment_method": "Cash",
  "subtotal": 1100.00,
  "discount_amount": 0.00,
  "total": 1100.00,
  "amount_paid": 1100.00,
  "balance": 0.00,
  "is_cash_sale": true
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Receipt printed"
}
```

### `POST /open-drawer`
Open the drawer without printing (e.g. "No Sale" button).

**Request body:**
```json
{}
```

**Response:**
```json
{
  "status": "success",
  "message": "Cash drawer opened"
}
```

### `GET /health`
Check if the agent is running.

**Response:**
```json
{
  "status": "ok",
  "service": "Obello POS Print Agent"
}
```

## Troubleshooting

**"Could not open cash drawer"** or **"Print failed"**
- Is the printer turned on and connected?
- Is the USB cable plugged in?
- On Windows, did you run Zadig to swap the driver?
- Check `/tmp/print-agent.log` (Mac) or Event Viewer (Windows) for more details

**Printer not found (USB error)**
- Try a different USB port
- On Windows, rerun Zadig — sometimes a reboot is needed after installing a new driver

**Port 8899 already in use**
- Edit `app.py`, change `PORT = 8899` to another number (e.g. 8900)
- Restart the agent

## Configuration

Open `app.py` and edit these at the top:
- `SHOP_NAME` — printed on every receipt
- `SHOP_ADDRESS` — printed on every receipt
- `RECEIPT_WIDTH_CHARS` — 32 for 58mm paper (default), 40-42 for 80mm printers
- `PORT` — which port to listen on (default 8899)

After editing, restart the agent.

## Supported Printers

Tested with **58mm USB ESC/POS thermal printers** (the most common type for small shops). The code should work with any ESC/POS printer (Epson, Star, Sunmi, etc.) as long as it supports the standard ESC/POS command set.

Printer model references:
- `Usb(0x1FC9, 0x2016, profile="NT-5890K")` — Default (edit `app.py` `connect_receipt_printer()` if yours is different)
- Common vendor/product IDs: `0x0471, 0x0055` (Epson) | `0x0483, 0x5720` (others)

If your printer isn't detected, try:
```bash
python -m pyusb.tools.lsusb  # Lists all USB devices and their IDs
```

Then edit the IDs in `app.py`.

## Questions or Issues?

- Check the logs: `tail -f /tmp/print-agent.log` (Mac) or check Event Viewer (Windows)
- Verify the agent is running: `curl http://localhost:8899/health`
- Make sure the Vue app is calling the right port (should be 8899 in `POSView.vue`)
