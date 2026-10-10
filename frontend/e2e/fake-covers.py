"""A stand-in for MusicBrainz + the Cover Art Archive for the browser checks (never touches the real services).

    python3 fake-covers.py 18203
    start the backend with MUSICBRAINZ_BASE_URL=http://127.0.0.1:18203/ws/2 COVERART_BASE_URL=http://127.0.0.1:18203

Recordings titled "Testlied" have ONE clear album; "Anderes Lied" has two different ones (the person has to choose).
"""
import json
import struct
import sys
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


def png(rgb, size=32):
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


IMAGES = {"mb-1": png((200, 60, 60)), "mb-2": png((60, 160, 90)), "mb-3": png((60, 90, 200))}


def release(mbid, title, artist):
    return {"id": mbid, "title": title, "date": "2001-02-03", "artist-credit": [{"name": artist, "joinphrase": ""}]}


class Handler(BaseHTTPRequestHandler):
    def _json(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.endswith("/recording"):
            q = parse_qs(url.query).get("query", [""])[0]
            if "Testlied" in q:
                return self._json({"recordings": [{"score": 100, "releases": [release("mb-1", "Das Album", "Band")]}]})
            if "Anderes Lied" in q:
                return self._json({"recordings": [{"score": 100, "releases": [release("mb-2", "Erstes Album", "Zweite Band"), release("mb-3", "Zweites Album", "Zweite Band")]}]})
            return self._json({"recordings": []})
        if url.path.endswith("/release") and url.path.startswith("/ws/2"):
            return self._json({"releases": []})
        parts = url.path.strip("/").split("/")  # release/<mbid>/front-500
        if len(parts) == 3 and parts[0] == "release" and parts[1] in IMAGES:
            data = IMAGES[parts[1]]
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 18203), Handler).serve_forever()
