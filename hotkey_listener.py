import ctypes
from ctypes import wintypes
import os
import subprocess
import webbrowser

user32 = ctypes.windll.user32

# Modifiers: MOD_ALT = 0x0001, MOD_CONTROL = 0x0002, MOD_SHIFT = 0x0004, MOD_WIN = 0x0008
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
VK_P = 0x50
HOTKEY_ID = 1

def open_jarvis():
    # Ensure server is running
    try:
        import urllib.request
        urllib.request.urlopen("http://localhost:3001", timeout=0.8)
    except Exception:
        # Start server in background
        subprocess.Popen(
            ["python", "-m", "http.server", "3001", "--directory", r"C:\Users\Monish\jarvis-os"],
            creationflags=subprocess.CREATE_NO_WINDOW
        )
    webbrowser.open("http://localhost:3001")

def main():
    # Register Ctrl + Alt + P
    if not user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_ALT, VK_P):
        print("Failed to register hotkey. It might be in use by another program.")
        return

    print("JARVIS Hotkey Listener active! Press Ctrl + Alt + P anytime.")

    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        if msg.message == 0x0312:  # WM_HOTKEY
            if msg.wParam == HOTKEY_ID:
                open_jarvis()
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))

if __name__ == "__main__":
    main()
