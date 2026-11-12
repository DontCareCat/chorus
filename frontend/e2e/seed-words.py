"""Fill the dictionary of an isolated e2e stack with N plain words (the guest's): python3 seed-words.py <data-dir>/app.db 3275"""
import sqlite3, sys
from datetime import datetime, timedelta
db = sqlite3.connect(sys.argv[1]); n = int(sys.argv[2])
db.execute("delete from dictionary_entries")
t0 = datetime(2026, 1, 1)
rows = [(1, "de", f"wort{i:04d}", f"Wort{i:04d}", f"word {i}", "en", "done", 0, (t0 + timedelta(seconds=i)).strftime("%Y-%m-%d %H:%M:%S.000000"), 0, 0, 0, 1, "game") for i in range(1, n + 1)]
db.executemany("insert into dictionary_entries (user_id,language,word,surface,translation,translation_language,enrich_status,suspended,added_at,interval_seconds,reps,lapses,lookup_version,source) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
db.commit(); print(db.execute("select count(*) from dictionary_entries").fetchone()[0])
