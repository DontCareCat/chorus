"""Start a packaged build headless and check it really works: python packaging/smoke.py <path to executable>

Proves that migrations, the bundled frontend and the wordfreq data made it into the package. The temp data dir
also checks that nothing is written next to the executable.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
import wave
from pathlib import Path


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read()


LRC = "\n".join(f"[00:{i * 5:02d}.00] {t}" for i, t in enumerate([
    "Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt",
    "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt",
    "Ich liebe meine kleine Wohnung sehr", "Der Mond steht hoch am Himmel heute"]))


def post(url: str, *, json_body=None, files=None) -> dict:
    """Minimal multipart/JSON POST with the standard library."""
    if files:
        boundary = uuid.uuid4().hex
        body = b"".join(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n".encode() + data + b"\r\n"
            for name, data in files
        ) + f"--{boundary}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    else:
        body, headers = json.dumps(json_body).encode(), {"Content-Type": "application/json"}
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def make_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 8000 * 40)


def snapshot(folder: Path) -> set[str]:
    return {str(p) for p in folder.rglob("*") if "__pycache__" not in p.parts}


def main(executable: str) -> int:
    exe = Path(executable).resolve()
    app_dir = exe.parent if exe.suffix != ".app" else exe
    before = snapshot(app_dir)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory() as data:
        env = {**os.environ, "CHORUS_DATA_DIR": data}
        proc = subprocess.Popen([str(exe), "serve", "--port", str(port)], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            base = f"http://127.0.0.1:{port}"
            for _ in range(120):
                try:
                    health = json.loads(get(base + "/api/health"))
                    break
                except OSError:
                    if proc.poll() is not None:
                        raise SystemExit(f"server exited early:\n{proc.stdout.read()}")
                    time.sleep(0.5)
            else:
                raise SystemExit("server did not start in 60 s")
            assert health["app"] == "chorus", health
            assert b'<div id="root">' in get(base + "/"), "frontend not bundled"
            assert "default_language" in json.loads(get(base + "/api/settings")), "migrations/settings failed"
            me = json.loads(get(base + "/api/auth/me"))
            assert me["user"]["is_guest"] and me["allow_guest"], "guest access is not the default"
            signed = post(base + "/api/auth/register", json_body={"username": "smoke", "password": "smoke test pass"})
            assert signed["user"]["is_admin"], "creating an account failed (password hashing unavailable in this build?)"
            wav = Path(data) / "Band - Lied.wav"
            make_wav(wav)
            song = post(base + "/api/songs", files=[("Band - Lied.wav", wav.read_bytes())])
            post(f"{base}/api/songs/{song['id']}/lyrics/upload", files=[("l.lrc", LRC.encode())])
            game = post(base + "/api/games", json_body={"song_id": song["id"], "difficulty": "medium"})
            assert game["questions"], "no questions generated (wordfreq data missing from the package?)"
            assert (Path(data) / "app.db").is_file(), "database not created in the data dir"
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
    assert snapshot(app_dir) == before, "the app directory was modified while running"
    print(f"OK: {exe.name} {health['version']} serves the app on port {port}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
