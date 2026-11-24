#!/usr/bin/env python3
"""Serve SAMURAI WATCH on this computer and refresh its local data."""

import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import sys
from threading import Lock, Thread, Timer
from time import monotonic
from urllib.parse import urlsplit
import webbrowser

mimetypes.add_type("application/manifest+json", ".webmanifest")

ROOT = Path(__file__).resolve().parents[1]
APP_FILES = {
    f"/{name}": ROOT / name
    for name in (
        "index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest",
        "assets/icon-192.png", "assets/icon-512.png", "assets/apple-touch-icon.png",
        "assets/favicon.svg", "assets/hero.webp", "assets/editorial.webp",
        "data/jfa.json", "data/players.json", "data/clubs.json",
        "data/ranking.json", "data/lineups.json", "data/profiles.json", "data/portraits.json",
        "data/current-squad.json", "data/current-clubs.json", "data/current-health.json", "data/fpl.json",
        "data/player-biographies.json", "data/jfa-profiles.json",
    )
}
MATCH_INTERVAL = 3 * 60 * 60
CLUB_INTERVAL = 24 * 60 * 60
PORTRAIT_INTERVAL = 7 * 24 * 60 * 60
PORTRAIT_PATH = re.compile(r"/assets/portraits/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)")


class Updates:
    def __init__(self):
        self.lock = Lock()
        self.running = False
        self.finished = False
        self.failed = False
        self.last_club = 0
        self.last_portraits = 0

    def status(self):
        with self.lock:
            if self.running:
                return "running"
            if self.failed:
                return "failed"
            return "finished" if self.finished else "waiting"

    def start(self, manual=False):
        with self.lock:
            if self.running:
                return
            self.running = True
        Thread(target=self.run, args=(manual,), daemon=True).start()

    def run(self, manual):
        scripts = [("update_squad.py", 30), ("update_fpl.py", 45), ("update_ranking.py", 90), ("refresh_jfa.py", 120)]
        if manual or not self.last_portraits or monotonic() - self.last_portraits >= PORTRAIT_INTERVAL:
            scripts.append(("update_portraits.py", 150))
            self.last_portraits = monotonic()
        if os.environ.get("API_FOOTBALL_KEY") and (manual or not self.last_club or monotonic() - self.last_club >= CLUB_INTERVAL):
            scripts.append(("update_clubs.py", 900))
            self.last_club = monotonic()
        failed = False
        try:
            for name, timeout in scripts:
                try:
                    result = subprocess.run([sys.executable, str(ROOT / "scripts" / name)], cwd=ROOT, timeout=timeout, check=False)
                    failed |= result.returncode != 0
                except (OSError, subprocess.TimeoutExpired) as error:
                    print(f"{name}: {error}", file=sys.stderr, flush=True)
                    failed = True
        finally:
            with self.lock:
                self.running = False
                self.finished = True
                self.failed = failed


class AppHandler(BaseHTTPRequestHandler):
    def __init__(self, updates, *args, **kwargs):
        self.updates = updates
        super().__init__(*args, **kwargs)

    def send_body(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def allowed_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def do_GET(self):
        if not self.allowed_host():
            self.send_error(403)
            return
        route = urlsplit(self.path).path
        if route == "/__local/status":
            self.send_body(json.dumps({"state": self.updates.status()}).encode(), "application/json")
            return
        path = APP_FILES.get("/index.html" if route == "/" else route)
        if path is None and PORTRAIT_PATH.fullmatch(route):
            path = ROOT / route.lstrip("/")
        if path is None or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        if path.name == "index.html":
            data = data.replace(b"<head>", b"<head>\n  <script>window.samuraiLocal = true;</script>", 1)
        self.send_body(data, mimetypes.guess_type(path)[0] or "application/octet-stream")

    do_HEAD = do_GET

    def do_POST(self):
        if not self.allowed_host() or self.headers.get("X-Samurai-Local") != "1":
            self.send_error(403)
            return
        if self.path != "/__local/refresh":
            self.send_error(404)
            return
        self.updates.start(manual=True)
        self.send_body(b"{}", "application/json", 202)

    def log_message(self, format, *args):
        if args[1] not in ("200", "202"):
            super().log_message(format, *args)


def schedule(updates):
    updates.start()
    timer = Timer(MATCH_INTERVAL, schedule, args=(updates,))
    timer.daemon = True
    timer.start()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true", help="Open the app in the default browser")
    args = parser.parse_args()
    updates = Updates()
    with ThreadingHTTPServer(("127.0.0.1", args.port), partial(AppHandler, updates)) as server:
        address = f"http://127.0.0.1:{server.server_port}/"
        print(f"SAMURAI WATCH  {address}", flush=True)
        if args.open:
            Thread(target=webbrowser.open, args=(address,), daemon=True).start()
        schedule(updates)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nSAMURAI WATCH を終了しました。", flush=True)


if __name__ == "__main__":
    main()
