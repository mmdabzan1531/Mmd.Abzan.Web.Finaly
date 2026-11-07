"""Run once on a computer with normal internet (or in your build step), then commit the result:
    python static/vendor/get-socketio.py
Downloads Socket.IO client 4.7.5 next to this script as socket.io.min.js (tries several mirrors)."""
import os, sys, urllib.request
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "socket.io.min.js")
SRC = ["https://cdn.jsdelivr.net/npm/socket.io-client@4.7.5/dist/socket.io.min.js",
       "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js",
       "https://cdn.socket.io/4.7.5/socket.io.min.js",
       "https://unpkg.com/socket.io-client@4.7.5/dist/socket.io.min.js"]
for u in SRC:
    try:
        data = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read()
        if len(data) > 20000 and b"io" in data[:4000]:
            open(OUT, "wb").write(data); print("OK", len(data), "bytes from", u); sys.exit(0)
    except Exception as e:
        print("failed:", u, e)
sys.exit("could not download: open one of the URLs above in a browser and save the file as " + OUT)
