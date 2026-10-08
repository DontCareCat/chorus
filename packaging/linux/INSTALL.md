# Chorus on a Linux server (no Docker)

This archive holds a self-contained Chorus: no Python or Node needed. x86-64 or arm64 Linux with systemd.

```bash
sudo mkdir -p /opt/chorus /etc/chorus
sudo cp -r chorus/. /opt/chorus/                       # the folder from this archive
sudo cp chorus.service /etc/systemd/system/
sudo cp chorus.env.example /etc/chorus/chorus.env      # edit: host, port, library folders, database
sudo systemctl daemon-reload
sudo systemctl enable --now chorus
```

- It listens on `127.0.0.1:8000` until you change `CHORUS_HOST` in `/etc/chorus/chorus.env`.
  **There is no login.** Only open it to a network you trust, or put a reverse proxy with authentication in front.
- The database and uploaded songs are in `/var/lib/chorus` (not in `/opt/chorus`, so updating the program never touches your data).
- Logs: `journalctl -u chorus -f`. Update: stop the service, replace the contents of `/opt/chorus`, start it again; the database is migrated automatically.
- Without systemd: `CHORUS_DATA_DIR=$HOME/.chorus ./chorus serve --port 8000`.
