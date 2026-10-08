"""A tiny stand-in for LRCLIB so the browser checks never touch the real service.

    python3 fake-lrclib.py 18202      then start the backend with LRCLIB_BASE_URL=http://127.0.0.1:18202/api

It knows two lyrics for the song "Band - Testlied" (60 s): id 1 and id 2 (different lines).
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

FIRST = "\n".join(f"[00:{i * 5:02d}.00] {t}" for i, t in enumerate([
    "Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt",
    "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt",
    "Ich liebe meine kleine Wohnung sehr", "Der Mond steht hoch am Himmel heute",
    "Im Garten blühen rote Blumen", "Das Kind spielt mit dem kleinen Hund",
    "Wir trinken Kaffee am frühen Morgen", "Die Straße ist voller bunter Lichter",
    "Mein Freund wohnt in einer großen Stadt", "Der Regen fällt auf unser Dach"]))
SECOND = "\n".join(f"[00:{i * 5:02d}.00] {t}" for i, t in enumerate([
    "Wir tanzen durch die ganze Nacht", "Der Regen fällt auf unser Dach", "Ein neuer Tag beginnt ganz leise",
    "Die Straße ist so still und leer", "Ich denke oft an dich zurück", "Das Licht geht langsam wieder an",
    "Im Zimmer riecht es nach Kaffee", "Mein Herz schlägt schneller als der Zug",
    "Wir singen laut und ohne Angst", "Der Himmel wird ganz langsam rot",
    "Die Stadt erwacht und ich bin wach", "Ein Lied geht durch den frühen Morgen"]))
ENTRIES = {
    1: {"id": 1, "artistName": "Band", "trackName": "Testlied", "albumName": "A", "duration": 60.0, "instrumental": False, "syncedLyrics": FIRST, "plainLyrics": ""},
    2: {"id": 2, "artistName": "Band", "trackName": "Testlied (live)", "albumName": "B", "duration": 60.4, "instrumental": False, "syncedLyrics": SECOND, "plainLyrics": ""},
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.endswith("/search"):
            return self._send(200, list(ENTRIES.values()))
        if "/get/" in url.path:
            entry = ENTRIES.get(int(url.path.rsplit("/", 1)[1]))
            return self._send(200, entry) if entry else self._send(404, {})
        if url.path.endswith("/get"):
            q = parse_qs(url.query)
            if q.get("track_name", [""])[0].lower() == "testlied":
                return self._send(200, ENTRIES[1])
        return self._send(404, {})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 18202), Handler).serve_forever()
