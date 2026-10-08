// Real-browser checks of: seeking, difficulty levels / multi-blank prompts, cover art, song removal, folder import.
// Needs: backend + `vite` as for browser-check.cjs (CHORUS_URL for another port), fixtures: song 1 "Band - Testlied.wav" with an
// embedded PNG cover + synced lyrics, song 2 without cover/lyrics, and a folder tree (3 wavs: top, sub/, sub/deep/) at TREE_DIR.
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:5173/";
const TREE = process.env.TREE_DIR;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const num = (t) => Number(/(\d+)/.exec(t)[1]);

async function newGame(page, level) {
  await page.goto(B); await page.waitForSelector(".song");
  await page.click('.song >> nth=0 >> .play-btn');
  await page.click(`.segmented button:has-text("${level}")`);
  await page.click('button:has-text("Start new game")');
  await page.waitForSelector(".prompt");
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());

  console.log("[difficulty levels: 10 / 30 / 60 / 80 % of the words]");
  const counts = {};
  for (const [level, pct] of [["Easy", 10], ["Medium", 30], ["Hard", 60], ["Expert", 80]]) {
    await newGame(page, level);
    counts[level] = num(await page.textContent(".prompt-count").then(() => page.evaluate(() => document.querySelector(".prompt-count").textContent.replace(/.* of (\d+).*/, "of $1"))));
    const dto = await page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()));
    counts[level] = dto.questions.length;
    console.log(`  ${level}: ${dto.questions.length} questions`);
  }
  const words = 65; // total words in the unique lines of the fixture lyrics (see tests/test_generator.py LINES for the same idea)
  ok(counts.Easy < counts.Medium && counts.Medium < counts.Hard && counts.Hard < counts.Expert, "each level asks more questions than the one before");
  ok(counts.Expert > counts.Easy * 4, `expert asks far more than easy (${counts.Expert} vs ${counts.Easy})`);
  await page.goto(B); await page.click('.song >> nth=0 >> .play-btn');
  ok((await page.textContent(".start-panel")).includes("30% of words"), "the start panel states the share of the default level (medium)");
  await page.click('.segmented button:has-text("Expert")');
  ok((await page.textContent(".start-panel")).includes("80% of words"), "and updates it when the level changes");

  console.log("[multi-blank prompt]");
  await newGame(page, "Expert");
  const dto = await page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()));
  const multi = Object.values(dto.questions.reduce((m, q) => ((m[q.line_id] ??= []).push(q), m), {})).find((g) => g.length > 1);
  ok(!!multi, "an expert game has lines with several blanks");
  const first = multi[0];
  await page.click(`.runway-tick[data-qid="${first.id}"]`);
  ok((await page.textContent(".prompt-count")).includes("blank 1 of " + multi.length), "the panel says which blank of the line is asked: " + (await page.textContent(".prompt-count")));
  const blanks = await page.$$eval(".prompt .blank", (els) => els.map((e) => ({ s: e.dataset.state, a: e.dataset.active, t: e.textContent.trim() })));
  ok(blanks.length === multi.length, `all ${multi.length} blanks of the line are hidden in the sentence`);
  ok(blanks.filter((b) => b.a === "true").length === 1 && blanks.every((b) => b.t === ""), "exactly one is the active blank; none shows a word yet");
  await page.keyboard.press("1");
  await page.waitForTimeout(250);
  const after = await page.$$eval(".prompt .blank", (els) => els.map((e) => ({ s: e.dataset.state, t: e.textContent.trim() })));
  ok(after[0].t !== "" && after.slice(1).every((b) => b.t === ""), "answering one blank fills only that blank, the others stay hidden");
  await page.waitForFunction(() => /blank 2 of/.test(document.querySelector(".prompt-count").textContent), null, { timeout: 4000 });
  const next = await page.$$eval(".prompt .blank", (els) => els.map((e) => ({ s: e.dataset.state, a: e.dataset.active, t: e.textContent.trim() })));
  ok(next[0].s === "filled" && next[0].t !== "" && next[1].a === "true", "the next question is blank 2; blank 1 is now shown filled in");
  const hiddenBlanks = (await page.$$(`.lw-line[data-qid="${multi[1].id}"] .lw-blank`)).length;
  const shownWords = (await page.$$(`.lw-line[data-qid="${multi[1].id}"] .lw-word`)).length;
  ok(hiddenBlanks === multi.length - 1 && shownWords === 1, `the lyric window shows the answered blank filled and the other ${multi.length - 1} still hidden`);

  console.log("[seeking in the game]");
  await newGame(page, "Easy");
  await page.click('button[aria-label="Play"]');
  await page.waitForFunction(() => window.__chorus && window.__chorus.controller);
  await page.waitForTimeout(800);
  const t = () => page.evaluate(() => document.querySelector("audio").currentTime);
  const state = () => page.evaluate(() => window.__chorus.controller.state.name);
  ok((await page.getAttribute("input.seek", "max")) > 59, "the slider spans the song (max " + (await page.getAttribute("input.seek", "max")) + " s)");
  // click on the runway line → seeks (the first questions are open, so jump back near the start)
  const box = await page.locator(".runway").boundingBox();
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.55);
  await page.waitForTimeout(500);
  const afterClick = await t();
  ok(afterClick < 8 && afterClick > 1, `clicking the timeline moves the audio (now ${afterClick.toFixed(1)} s)`);
  // arrow keys: the open question's deadline limits ArrowRight, ArrowLeft always works
  const before = await t();
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(400);
  ok((await t()) - before < 3.5 && (await t()) <= 8.4, `ArrowRight cannot jump past the open question's deadline (${before.toFixed(1)} s → ${(await t()).toFixed(1)} s)`);
  ok(/Answer the open question first/.test(await page.textContent(".last-answer")), "and says why");
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(400);
  ok((await t()) < before - 0.5, "ArrowLeft jumps back");
  // slider: far ahead is limited — an unanswered question cannot be skipped, so nothing is triggered
  const setSlider = async (v) => { await page.evaluate((val) => { const el = document.querySelector("input.seek"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(val)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v); await page.dispatchEvent("input.seek", "pointerup"); await page.waitForTimeout(500); };
  await setSlider(50);
  ok((await t()) < 12 && (await state()) !== "FADING_OUT", `dragging far ahead is limited to the open question (audio at ${(await t()).toFixed(1)} s), no fade-out or rewind`);
  ok(/Answer the open question first/.test(await page.textContent(".last-answer")), "and says why: " + (await page.textContent(".last-answer")));
  await page.waitForFunction(() => window.__chorus.controller.state.name === "PAUSED_FOR_QUESTION", null, { timeout: 15000 });
  await setSlider(2);
  ok(Math.abs((await t()) - 2) < 0.6 && (await state()) === "PAUSED_FOR_QUESTION", "seeking back while waiting is allowed and the game keeps waiting");

  console.log("[cover art]");
  await page.goto(B); await page.waitForSelector(".song");
  const covers = await page.$$eval(".song", (rows) => rows.map((r) => { const i = r.querySelector(".cover img"); return { title: r.querySelector(".song-title").textContent, img: !!i, w: i ? i.naturalWidth : 0 }; }));
  console.log("  " + JSON.stringify(covers));
  ok(covers.find((c) => c.title === "Testlied").w === 96, "the song with an embedded cover shows it (96 px source)");
  ok(!covers.find((c) => c.title === "Anderes Lied").w, "the song without one shows an empty square, no broken image");
  await newGame(page, "Easy");
  ok((await page.$eval(".game-head .cover img", (i) => i.naturalWidth)) === 96, "the game header shows the cover");
  await page.goto(B + "#/songs/1"); await page.waitForSelector(".lyric-line");
  ok((await page.$eval(".page-head .cover img", (i) => i.naturalWidth)) === 96, "the song page shows the cover");

  console.log("[folder import with the recursive option]");
  await page.goto(B); await page.waitForSelector(".song");
  const before2 = (await page.$$(".song")).length;
  await page.click('button:has-text("Add music")');
  await page.fill('input[placeholder*="Music"]', TREE);
  await page.uncheck("text=Include subfolders");
  await page.click('button:has-text("Import")');
  await page.waitForSelector(".notice.ok");
  ok(/1 added/.test(await page.textContent(".notice.ok")), "without subfolders only the top-level file is added: " + (await page.textContent(".notice.ok")));
  await page.fill('input[placeholder*="Music"]', TREE);
  await page.check("text=Include subfolders");
  await page.click('button:has-text("Import")');
  await page.waitForFunction(() => /2 added, 1 already known/.test(document.querySelector(".notice.ok")?.textContent ?? ""), null, { timeout: 8000 });
  ok(true, "with subfolders the other two are added, the first is recognised: " + (await page.textContent(".notice.ok")));
  ok((await page.$$(".song")).length === before2 + 3, "three new songs listed");

  console.log("[remove a song]");
  const n = (await page.$$(".song")).length;
  const row = page.locator(".song", { hasText: "Deep Three" });
  await row.getByRole("button", { name: /Remove/ }).click();
  await page.waitForFunction((c) => document.querySelectorAll(".song").length === c - 1, n, { timeout: 5000 });
  ok(/Removed "Deep Three"/.test(await page.textContent(".notice.ok")), "the song disappears and the page confirms: " + (await page.textContent(".notice.ok")));
  await page.reload(); await page.waitForSelector(".song");
  ok((await page.$$(".song")).length === n - 1, "it stays gone after a reload");

  console.log("[a file that is not audio is rejected with a reason]");
  await page.goto(B); await page.waitForSelector(".song");
  await page.click('button:has-text("Add music")');
  await page.setInputFiles('input[type="file"][accept*=".mp3"]', { name: "fake.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("this is not audio at all") });
  await page.waitForSelector(".notice.error", { timeout: 8000 });
  const upErr = await page.textContent(".notice.error");
  ok(/fake\.mp3/.test(upErr) && /not a readable audio file/.test(upErr) && (upErr.match(/fake\.mp3/g) ?? []).length === 1, "the notice names the file once and says why: " + upErr);

  console.log("[audio file went missing]");
  const fs = require("fs"), os = require("os"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-missing-"));
  const wav = path.join(dir, "Gone - Verschwunden.wav");
  const bytes = fs.readFileSync(path.join(TREE, "T1 - Top One.wav"));
  bytes[200] ^= 0x55; // one changed sample: a different file (not a duplicate of an already imported one), still valid audio
  fs.writeFileSync(wav, bytes);
  const imp = await page.request.post(B + "api/library/import", { data: { path: wav, recursive: false } });
  ok(imp.ok(), "a song is imported in place from " + dir);
  const songs = await (await page.request.get(B + "api/songs")).json();
  const gone = songs.find((s) => s.title === "Verschwunden");
  await page.request.post(B + `api/songs/${gone.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:00.20] Ich gehe jeden Morgen zur Arbeit\n[00:01.40] Wir fahren mit dem Zug zum Bahnhof") } } });
  const g = await (await page.request.post(B + "api/games", { data: { song_id: gone.id, difficulty: "easy" } })).json();
  fs.unlinkSync(wav); // the file disappears after the game was created
  await page.goto(B + "#/games/" + g.public_id);
  await page.waitForSelector(".prompt");
  await page.waitForSelector(".notice.error", { timeout: 8000 });
  ok(/audio file could not be loaded/.test(await page.textContent(".notice.error")), "the game page says so: " + (await page.textContent(".notice.error")));
  await page.click('button[aria-label="Play"]');
  await page.waitForFunction(() => window.__chorus?.controller?.state.name === "ERROR", null, { timeout: 8000 });
  ok(/cannot be played/.test(await page.textContent(".state-line")), "pressing play explains it (and does not blame the autoplay policy): " + (await page.textContent(".state-line")));
  ok(await page.isVisible(".prompt") && (await page.$$(".opt")).length === 4, "the questions are still usable");
  fs.rmSync(dir, { recursive: true, force: true });

  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL FEATURE CHECKS PASSED");
})();
