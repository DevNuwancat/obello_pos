# Quick Setup: POS Printer + Cash Drawer

Your app now prints receipts and opens the cash drawer automatically! Here's what you need to do **once per till computer**.

## Step 1: Install Python
If you don't have Python installed:

**Mac:**
```bash
brew install python3
```

**Windows:**
Download from https://www.python.org/downloads/ → click "Install Now" → make sure "Add Python to PATH" is checked

## Step 2: Set up the printer (one-time per till)

### Mac
```bash
brew install libusb
```

### Windows (THIS IS IMPORTANT!)
1. Plug in your thermal printer via USB
2. Download **Zadig** from https://zadig.akeo.ie/
3. Open Zadig, find your printer in the list (e.g. "NT-5890K" or your model)
4. In the dropdown, select **"WinUSB"**
5. Click **"Install Driver"** and wait for it to finish
6. Done! Zadig can be closed and uninstalled after this

## Step 3: Create a virtual environment (isolated Python packages)
This keeps the print agent's Python packages separate from anything else on your computer.

```bash
cd /path/to/obello_pos/print-agent

# Create the virtual environment (one-time)
python3 -m venv venv

# Activate it (do this every time before running the agent)
# Mac/Linux:
source venv/bin/activate

# Windows:
venv\Scripts\activate
```

Replace `/path/to` with where your `obello_pos` folder actually is.

After running one of those, you should see `(venv)` appear at the start of your command prompt — that means the venv is active.

## Step 4: Install the print agent
```bash
pip install -r requirements.txt
```

(Make sure you've activated the venv in Step 3 first!)

## Step 5: Start the print agent
```bash
python app.py
```

You should see:
```
🖨️  Obello POS Print Agent starting on http://localhost:8899
```

**Keep this terminal/window open and running** (minimize if needed).

## Step 6: Test
In another terminal, try:
```bash
curl http://localhost:8899/health
```

If you see `{"status":"ok"...}`, the agent is running! ✓

## Step 7: Use it in your POS app

1. Start your Obello POS app (Vue app in Chrome)
2. Go to the checkout
3. When you check "Print Receipt" and complete the order, the receipt will **automatically print** and the drawer will **pop open** (if it's a cash sale)

## If something doesn't work

- **Printer not found?**
  - Is it turned on and connected via USB?
  - On Windows, did you use Zadig? (Check Device Manager — should show as "WinUSB")
  - Try a different USB port
  
- **"Could not reach printer" message in the app?**
  - The print agent isn't running — go back to Step 4 and start it
  
- **Drawer won't open?**
  - Check that the RJ11/RJ12 cable from the drawer is plugged into the printer
  - The printer might need to be reset; turn it off for 10 seconds and on again

## Auto-start (so you don't have to run the script manually every time)

**Mac (LaunchAgent):**
```bash
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

launchctl load ~/Library/LaunchAgents/com.obello.printAgent.plist
```

**Windows (Task Scheduler):**
1. Press `Win + R` and type `taskschd.msc` → press Enter
2. Click "Create Basic Task" → give it a name "Obello Print Agent"
3. Trigger: Select "At startup"
4. Action: "Start a program"
   - **Program:** `C:\path\to\obello_pos\print-agent\venv\Scripts\python.exe`
   - **Arguments:** `C:\path\to\obello_pos\print-agent\app.py`
5. Check "Run with highest privileges"
6. Click OK

Then, whenever your till computer boots, the agent starts automatically in the background.

## Done!

Your POS receipts will print and the cash drawer will pop open. No more manual stuff. 🎉

For more details, see `README.md` in the print-agent folder.
