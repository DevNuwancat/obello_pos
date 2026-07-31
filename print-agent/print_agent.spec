# PyInstaller build spec for the Obello POS Print Agent.
#
# What is this file? PyInstaller normally lets you build an exe with one
# command line, but our app needs an extra file bundled in (the shop logo),
# so we spell out the build steps here instead. Run it with:
#   pyinstaller print_agent.spec
#
# This must be run on a Windows machine (or Windows CI) to produce a .exe —
# PyInstaller builds for the OS it's running on, it can't cross-compile.

import sys
from pathlib import Path

block_cipher = None

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        (str(Path(SPECPATH).parent / "frontend" / "public" / "logo.png"), "."),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'escpos.printer',
        'usb.backend.libusb1',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ObelloPrintAgent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
