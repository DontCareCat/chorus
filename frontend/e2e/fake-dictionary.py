"""A stand-in for the translation service (MyMemory) and Wiktionary for the browser checks (never touches the real ones).

    python3 fake-dictionary.py 18204
    start the backend with TRANSLATE_BASE_URL=http://127.0.0.1:18204 WIKTIONARY_BASE_URL=http://127.0.0.1:18204

Translations look like "en(Wohnung)" / "uk(Wohnung)". Wiktionary knows the genders of a few German nouns.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

GENDER = {"Wohnung": "f", "Stadt": "f", "Arbeit": "f", "Sonne": "f", "Mond": "m", "Himmel": "m", "Zug": "m", "Bahnhof": "m"}


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
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/get":
            dst = q.get("langpair", "de|en").split("|")[1]
            return self._json({"responseData": {"translatedText": f"{dst}({q.get('q', '')})"}, "responseStatus": 200})
        if url.path == "/w/api.php":
            title = q.get("page", "")
            g = GENDER.get(title)
            if g is None:
                return self._json({"error": {"code": "missingtitle"}})
            return self._json({"parse": {"title": title, "wikitext": f"==German==\n===Noun===\n{{{{de-noun|{g}|-en}}}}\n# thing\n"}})
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 18204), Handler).serve_forever()
