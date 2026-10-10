import pytest

from app.services.lyrics.language import MIN_WORDS, detect_language
from tests.conftest import make_wav
from tests.test_api_library import upload

SAMPLES = {
    'de': 'Ich gehe jeden Morgen zur Arbeit\nDu hast mich gefragt und ich hab nichts gesagt\nWir fahren mit dem Zug zum Bahnhof',
    'en': 'I walk to work every morning\nYou asked me and I said nothing at all\nWe take the train to the station',
    'fr': "Je marche au travail chaque matin\nTu m'as demandé et je n'ai rien dit\nNous prenons le train pour aller à la gare", 'es': 'Camino al trabajo cada mañana\nMe preguntaste y no dije nada\nTomamos el tren hacia la estación',
    'it': 'Cammino verso il lavoro ogni mattina\nMi hai chiesto e non ho detto niente\nPrendiamo il treno per la stazione',
    'pt': 'Eu caminho para o trabalho todas as manhãs\nTu perguntaste e eu não disse nada\nApanhamos o comboio para a estação',
    'nl': 'Ik loop elke ochtend naar mijn werk\nJij vroeg het mij en ik zei niets\nWe nemen de trein naar het station',
    'sv': 'Jag går till jobbet varje morgon\nDu frågade mig och jag sa ingenting\nVi tar tåget till stationen',
    'da': 'Jeg går på arbejde hver morgen\nDu spurgte mig og jeg sagde ingenting\nVi tager toget til stationen',
    'nb': 'Jeg går på jobb hver morgen\nDu spurte meg og jeg sa ingenting\nVi tar toget til stasjonen',
    'pl': 'Chodzę do pracy każdego ranka\nZapytałeś mnie a ja nic nie powiedziałem\nJedziemy pociągiem na dworzec',
    'ru': 'Я иду на работу каждое утро\nТы спросил меня а я ничего не сказал\nМы едем на поезде на вокзал',
    'uk': 'Я йду на роботу щоранку\nТи запитав мене а я нічого не сказав\nМи їдемо потягом на вокзал',
    'tr': 'Her sabah işe yürüyorum\nSen bana sordun ve ben hiçbir şey demedim\nTrenle istasyona gidiyoruz',
    'cs': 'Chodím do práce každé ráno\nZeptal ses mě a já jsem nic neřekl\nJedeme vlakem na nádraží',
    'fi': 'Kävelen töihin joka aamu\nKysyit minulta ja minä en sanonut mitään\nMenemme junalla asemalle',
    'hu': 'Minden reggel munkába sétálok\nMegkérdeztél és én nem mondtam semmit\nVonattal megyünk az állomásra',
    'ro': 'Merg la muncă în fiecare dimineață\nM-ai întrebat și nu am spus nimic\nLuăm trenul spre gară',
    'el': 'Περπατάω στη δουλειά κάθε πρωί\nΜε ρώτησες κι εγώ δεν είπα τίποτα\nΠαίρνουμε το τρένο για το σταθμό',
    'id': 'Aku berjalan ke kantor setiap pagi\nKamu bertanya padaku dan aku tidak berkata apa-apa\nKami naik kereta ke stasiun'}


@pytest.mark.parametrize("language", sorted(SAMPLES))
def test_a_few_lines_are_enough_to_recognise_the_language(language):
    found = detect_language(SAMPLES[language])
    assert found is not None and found.language == language, (language, found)


def test_a_chorus_in_english_does_not_hide_a_german_song():
    text = "Baby baby baby oh\nIch lieb dich so sehr\nYeah yeah yeah\nDu bist alles was ich will\nOh oh oh\nWir tanzen die ganze Nacht"
    assert detect_language(text).language == "de"


def test_vocalising_too_little_text_or_nothing_gives_no_answer():
    assert detect_language("") is None
    assert detect_language("La la la\nOoh ooh ooh\nNa na na") is None  # no real words
    assert detect_language("Ich gehe") is None  # fewer than MIN_WORDS words
    assert detect_language("12345 67890 ...!!! ??? 123 456 789 000") is None
    assert MIN_WORDS >= 5


def test_a_language_without_a_word_list_is_not_forced_into_another():
    assert detect_language("私は毎朝仕事に歩いて行きます あなたは私に尋ねました 私は何も言いませんでした") is None


def test_the_answer_does_not_depend_on_line_breaks_case_or_punctuation():
    a = detect_language(SAMPLES["fr"])
    b = detect_language(SAMPLES["fr"].upper().replace("\n", " ... ") + "!!!")
    assert a.language == b.language == "fr"


def test_a_very_long_text_is_sampled_not_slow():
    import time

    text = (SAMPLES["de"] + "\n") * 400
    t = time.perf_counter()
    assert detect_language(text).language == "de"
    assert time.perf_counter() - t < 1.5


# ---------- what happens to a song ----------
LRC_FR = "\n".join(f"[00:{i * 4:02d}.00] {t}" for i, t in enumerate(SAMPLES["fr"].split("\n") + ["Le soleil brille sur la ville", "Je pense à toi tous les jours"]))
LRC_DE = "\n".join(f"[00:{i * 4:02d}.00] {t}" for i, t in enumerate(SAMPLES["de"].split("\n") + ["Die Sonne scheint über der Stadt", "Ich denke jeden Tag an dich"]))


@pytest.fixture
def song(api, tmp_path):
    return upload(api, make_wav(tmp_path / "Band - Lied.wav", seconds=30)).json()


def attach(api, song, lrc):
    r = api.post(f"/api/songs/{song['id']}/lyrics/upload", files={"file": ("l.lrc", lrc.encode(), "text/plain")})
    assert r.status_code == 201, r.text
    return next(s for s in api.get("/api/songs").json() if s["id"] == song["id"])


def test_a_new_song_takes_the_language_of_its_lyrics(api, song):
    assert (song["language"], song["language_source"]) == ("de", "default")  # the setting's default until there are lyrics
    row = attach(api, song, LRC_FR)
    assert (row["language"], row["language_source"]) == ("fr", "detected")


def test_different_lyrics_can_change_a_detected_language(api, song):
    attach(api, song, LRC_FR)
    assert attach(api, song, LRC_DE)["language"] == "de"


def test_a_language_a_person_chose_is_never_overridden(api, song):
    api.patch(f"/api/songs/{song['id']}", json={"language": "es"})
    row = attach(api, song, LRC_FR)
    assert (row["language"], row["language_source"]) == ("es", "manual")


def test_saving_the_song_details_marks_the_language_as_chosen(api, song):
    attach(api, song, LRC_FR)
    api.patch(f"/api/songs/{song['id']}", json={"title": "New title"})  # other fields do not count
    assert api.get("/api/songs").json()[0]["language_source"] == "detected"
    api.patch(f"/api/songs/{song['id']}", json={"language": "fr"})  # even the same language: it is a choice now
    assert api.get("/api/songs").json()[0]["language_source"] == "manual"


def test_detection_can_be_switched_off(api, song):
    api.put("/api/settings", json={**api.get("/api/settings").json(), "auto_detect_language": False})
    row = attach(api, song, LRC_FR)
    assert (row["language"], row["language_source"]) == ("de", "default")


def test_lyrics_that_are_too_short_leave_the_language_alone(api, song):
    row = attach(api, song, "[00:01.00] La la la\n[00:05.00] Ooh ooh")
    assert (row["language"], row["language_source"]) == ("de", "default")


def test_detect_on_request_overrides_an_earlier_choice(api, song):
    attach(api, song, LRC_FR)
    api.patch(f"/api/songs/{song['id']}", json={"language": "es"})
    r = api.post(f"/api/songs/{song['id']}/language/detect")
    assert r.status_code == 200 and (r.json()["language"], r.json()["language_source"]) == ("fr", "detected")


def test_detect_on_request_explains_why_it_cannot(api, song):
    r = api.post(f"/api/songs/{song['id']}/language/detect")
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_lyrics"
    api.put("/api/settings", json={**api.get("/api/settings").json(), "allow_unsynchronized_lyrics": True})
    api.post(f"/api/songs/{song['id']}/lyrics/upload", files={"file": ("l.txt", b"La la la\nOoh ooh ooh", "text/plain")})
    r = api.post(f"/api/songs/{song['id']}/language/detect")
    assert r.status_code == 422 and r.json()["error"]["code"] == "language_unclear"
    assert api.post("/api/songs/999/language/detect").status_code == 404
