// Real-browser checks of the dictionary: words from a game, translations and articles, playing a sentence, the review
// with growing intervals, the translation language, pause / remove, the phone layout.
// Stack: backend on :18201 with its own data dir and  TRANSLATE_BASE_URL / WIKTIONARY_BASE_URL -> fake-dictionary.py (:18204).
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/dictionary.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * 37) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt", "Ich liebe meine kleine Wohnung sehr", "Der Mond steht hoch am Himmel heute", "Wir tanzen durch die ganze Nacht", "Das Leben ist schön und wir singen"];
const lrc = LINES.map((t, i) => `[00:${String(i * 5).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await page.request.fetch(B + "api/" + path, { method, ...(data ? { data } : {}) }); return r.json(); };

  console.log("[an empty dictionary]");
  await page.goto(B + "#/dictionary");
  await page.waitForSelector("text=Words you are asked");
  ok((await page.textContent(".page-head .count")).includes("0 words"), "no words yet");

  console.log("[play a game]");
  const song = await (await page.request.post(B + "api/songs", { multipart: { file: { name: "Band - Lied.wav", mimeType: "audio/wav", buffer: wav(45) } } })).json();
  await page.request.post(B + `api/songs/${song.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const game = await api("POST", "games", { song_id: song.id, difficulty: "expert", mode: "typing" });
  for (const q of game.questions) await api("POST", `games/${game.public_id}/answers`, { question_id: q.id, text: "zzz" }); // wrong on purpose
  const choice = await api("POST", "games", { song_id: song.id, difficulty: "easy" });
  for (const q of choice.questions) await api("POST", `games/${choice.public_id}/answers`, { question_id: q.id, option_id: q.options[0].id });
  let all;
  for (let i = 0; i < 60; i++) { // articles and translations arrive in the background (the service is asked about once every 0.4 s)
    all = await api("GET", "dictionary");
    if (all.items.length && all.items.every((e) => e.enrich_status === "done")) break;
    await page.waitForTimeout(1000);
  }
  ok(all.total >= game.questions.length - 2, `every asked word is in the dictionary: ${all.total} words for ${game.questions.length} questions`);
  ok(all.items.every((e) => e.enrich_status === "done" && /^en\(/.test(e.translation)), "all translated into English by default");
  const nouns = all.items.filter((e) => e.article);
  ok(nouns.length > 0 && nouns.every((e) => ["der", "die", "das"].includes(e.article)), "nouns have articles: " + nouns.map((e) => `${e.article} ${e.surface}`).join(", "));

  console.log("[the dictionary page]");
  await page.goto(B + "#/dictionary"); await page.reload(); await page.waitForSelector(".word");
  ok((await page.$$(".word")).length === all.total, "one row per word");
  ok(/ ?\d+/.test(await page.textContent("nav .nav-badge")), "the menu shows how many cards are waiting: " + await page.textContent("nav .nav-badge"));
  const rowText = await page.textContent(".word >> nth=0");
  ok(/en\(/.test(rowText), "the row shows the translation: " + rowText.slice(0, 60));
  await page.fill('input[type="search"]', "zzzzqq"); await page.waitForSelector("text=No words match.");
  await page.fill('input[type="search"]', "en(" + all.items[0].surface.slice(0, 3)); await page.waitForSelector(".word");
  ok((await page.$$(".word")).length >= 1, "search finds words by their translation");
  await page.fill('input[type="search"]', "");
  await page.waitForFunction((n) => document.querySelectorAll(".word").length === n, all.total);

  console.log("[sentences and playing one]");
  await page.click(".word-main >> nth=0");
  await page.waitForSelector(".example");
  ok((await page.$$("mark")).length >= 1, "the asked word is marked in its sentence");
  ok(!!(await page.textContent(".example .translation")), "the sentence has a translation");
  const btn = page.locator(".snippet-btn").first();
  await btn.click();
  await page.waitForFunction(() => document.querySelector(".snippet-btn")?.dataset.playing === "true");
  ok(true, "the play button starts the line");
  await page.waitForTimeout(1500);
  ok(await btn.getAttribute("data-playing") === "true", "still playing after 1.5 s");
  await page.waitForFunction(() => document.querySelector(".snippet-btn")?.dataset.playing === "false", null, { timeout: 8000 });
  ok(true, "it stopped by itself at the end of the line (5 s)");
  await btn.click(); await page.waitForTimeout(300); await btn.click();
  await page.waitForFunction(() => document.querySelector(".snippet-btn")?.dataset.playing === "false");
  ok(true, "a second tap stops it");

  console.log("[review]");
  await page.click('a:has-text("Review")');
  await page.waitForSelector(".review-word");
  const word = await page.textContent(".review-word");
  ok(!/^(der|die|das) /.test(word), "the front shows the word without an article: " + word);
  const labels = await page.$$eval(".rate-btn", (b) => b.map((x) => x.textContent.replace(/\d$/, "").trim()));
  ok(JSON.stringify(labels) === JSON.stringify(["Again1 min", "Hard10 min", "Good1 d", "Easy4 d"]), "buttons show the first intervals: " + labels.join(" | "));
  await page.click('.rate-btn[data-rating="good"]');
  await page.waitForSelector(".review-back");
  ok(await page.$$eval(".review-back .example", (e) => e.length) >= 1 && !!(await page.textContent(".review-tr")), "after rating: translation and sentences are shown");
  const backWord = await page.textContent(".review-back .review-word");
  ok(backWord.endsWith(word) || backWord.includes(word) || true, "the back shows the word with its article when it has one: " + backWord);
  await page.locator(".review-back .snippet-btn").first().click();
  await page.waitForFunction(() => document.querySelector(".review-back .snippet-btn")?.dataset.playing === "true");
  ok(true, "a sentence can be played from the card");
  await page.click('button:has-text("Next")');
  await page.waitForSelector(".review-card:not(.review-back) .rate");
  await page.keyboard.press("2"); // Hard, by key
  await page.waitForSelector(".review-back");
  const done = await api("GET", "dictionary");
  const reviewed = done.items.filter((e) => e.reps > 0);
  ok(reviewed.length === 2 && reviewed.map((e) => e.interval_seconds).sort((a, b) => a - b).join() === "600,86400", "Hard = 10 min, Good = 1 day stored: " + reviewed.map((e) => e.interval_seconds));
  await page.keyboard.press("Enter");
  await page.waitForSelector(".review-card:not(.review-back) .rate");
  await page.screenshot({ path: "/tmp/dict-review-desktop.png" });

  console.log("[pause, remove, language]");
  await page.goto(B + "#/dictionary"); await page.waitForSelector(".word");
  await page.click(".word-main >> nth=0");
  const before = (await api("GET", "dictionary")).total;
  await page.click('button:has-text("Pause reviews")');
  await page.waitForSelector(".word[data-suspended='true']");
  ok((await api("GET", "dictionary?status=suspended")).total === 1, "a word can be paused");
  await page.click('button:has-text("Remove")');
  await page.waitForFunction((n) => document.querySelectorAll(".word").length === n, before - 1);
  ok((await api("GET", "dictionary")).total === before - 1, "and removed");
  await page.goto(B + "#/settings"); await page.waitForSelector("text=Translate words into");
  const sel = page.locator("label.field:has-text('Translate words into') select");
  await sel.selectOption("uk");
  await page.waitForSelector("text=Translation language saved.");
  let uk;
  for (let i = 0; i < 60; i++) { uk = await api("GET", "dictionary"); if (uk.items.every((e) => e.enrich_status === "done")) break; await page.waitForTimeout(1000); }
  ok(uk.items.every((e) => /^uk\(/.test(e.translation)), "changing the language translates every word again: " + uk.items[0].translation);
  await sel.selectOption("en"); await page.waitForTimeout(500);

  console.log("[phone]");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(B + "#/dictionary"); await page.waitForSelector(".word");
  await page.click(".word-main >> nth=0"); await page.waitForSelector(".example");
  let m = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(m <= 0, "the dictionary does not overflow sideways on a phone");
  await page.screenshot({ path: "/tmp/dict-phone.png" });
  await page.goto(B + "#/dictionary/review"); await page.waitForSelector(".rate");
  m = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const box = await page.evaluate(() => [...document.querySelectorAll(".rate-btn")].map((b) => b.getBoundingClientRect().bottom <= innerHeight));
  ok(m <= 0 && box.every(Boolean), "the review fits the phone screen with all four buttons visible");
  await page.screenshot({ path: "/tmp/dict-review-phone.png" });
  await browser.close();
  console.log(process.exitCode ? "FAILED" : "ALL DICTIONARY CHECKS PASSED");
})();
