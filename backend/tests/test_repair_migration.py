"""The 0014 repair: duplicate cards merged with their progress, bad meanings cleared, suspicious entries queued, a second run changes nothing."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa

spec = importlib.util.spec_from_file_location("m0014", Path(__file__).parent.parent / "migrations" / "versions" / "0014_repair_word_lookups.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

COLS = ("user_id,language,word,surface,lemma,article,translation,translation_language,enrich_status,suspended,added_at,interval_seconds,reps,lapses,"
        "due_at,introduced_at,last_reviewed_at,lookup_version")


def test_repair_merges_requeues_and_is_idempotent():
    e = sa.create_engine("sqlite://")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE dictionary_entries (id INTEGER PRIMARY KEY, user_id INT, language TEXT, word TEXT, surface TEXT, lemma TEXT, article TEXT, translation TEXT, "
                          "translation_language TEXT, enrich_status TEXT, suspended INT, added_at TEXT, interval_seconds INT, reps INT, lapses INT, due_at TEXT, introduced_at TEXT, "
                          "last_reviewed_at TEXT, lookup_version INT)"))
        c.execute(sa.text("CREATE TABLE dictionary_examples (id INTEGER PRIMARY KEY, entry_id INT, sentence TEXT)"))
        c.execute(sa.text("CREATE TABLE dictionary_cache (cache_key TEXT, payload TEXT)"))
        c.execute(sa.text("INSERT INTO dictionary_cache VALUES ('wk2:x', '{}'), ('wk3:y', '{}'), ('wk4:z', '{}')"))
        c.execute(sa.text(f"INSERT INTO dictionary_entries ({COLS}) VALUES "
                          "(1,'de','geh’n','geh’n',NULL,NULL,'to go','en','done',0,'2026-01-01',864000,5,1,'2030-01-01','2026-01-01','2026-06-01',0),"
                          "(1,'de','geh''n','geh''n',NULL,NULL,')','en','done',1,'2025-01-01',60,1,3,'2026-02-01','2025-01-01','2026-01-02',0),"
                          "(1,'de','zeit','Zeit',NULL,NULL,')','en','done',0,'2026-01-01',0,0,0,NULL,NULL,NULL,0),"
                          "(1,'de','haus','Haus',NULL,'das','house','en','done',0,'2026-01-01',0,0,0,NULL,NULL,NULL,0),"
                          "(1,'de','leiht','leiht','leihen',NULL,NULL,NULL,'failed',0,'2026-01-01',0,0,0,NULL,NULL,NULL,0)"))
        c.execute(sa.text("INSERT INTO dictionary_examples (entry_id, sentence) VALUES (1,'a b'),(2,'a b'),(2,'c d')"))
        first = m.repair(c)
        rows = {r[0]: r for r in c.execute(sa.text("SELECT word, reps, lapses, suspended, enrich_status, translation, interval_seconds FROM dictionary_entries")).all()}
        assert first["merged"] == 1 and first["meanings_cleared"] >= 1
        assert rows["geh'n"][1:4] == (5, 3, 0) and rows["geh'n"][6] == 864000  # the most advanced card's schedule; lapses the most; not paused unless all were
        assert rows["zeit"][4] == "pending" and rows["zeit"][5] is None  # bad meaning cleared, looked up again
        assert rows["haus#n"][4] == "done" and rows["haus#n"][5] == "house"  # sound: keyed from what is stored, no lookup
        assert rows["leiht"][4] == "pending"
        assert c.execute(sa.text("SELECT count(*) FROM dictionary_examples WHERE entry_id = (SELECT id FROM dictionary_entries WHERE word = \"geh'n\")")).scalar() == 2
        assert c.execute(sa.text("SELECT count(*) FROM dictionary_cache")).scalar() == 1  # the old wk2 rows are gone
        c.execute(sa.text("UPDATE dictionary_entries SET enrich_status = 'done', lookup_version = 1 WHERE enrich_status = 'pending'"))
        second = m.repair(c)
        assert second["merged"] == 0 and second["requeued"] == 0
