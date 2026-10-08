"""Start SmartFlix:  python run.py   ->  http://127.0.0.1:5000"""
import threading, webbrowser, os
from backend.app import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    print(f"\n  SmartFlix running -> http://127.0.0.1:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
