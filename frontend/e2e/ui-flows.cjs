// Real-browser check of the UI flows: settings persistence, uploading lyrics, timing offset, resuming and finishing a game.
// Same setup as browser-check.cjs (backend :8000 with songs 1 and 2 = tone files, song 1 has synced lyrics; `vite --port 5173`).
// Song 2 must start without lyrics on a fresh database; the script itself is repeatable.
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:5173/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  console.log("[settings]");
  await page.goto(B + "#/settings");
  await page.waitForSelector("text=Save settings");
  await page.check("text=Allow unsynchronized lyrics");
  await page.check("text=Keep forever");
  await page.fill('input[type="text"] >> nth=0', "fr");
  await page.fill("textarea", "/tmp/music-a\n/tmp/music-b");
  await page.click('button:has-text("Save settings")');
  await page.waitForSelector("text=Saved");
  await page.reload(); await page.waitForSelector("text=Save settings");
  ok(await page.isChecked("text=Allow unsynchronized lyrics"), "unsynchronized toggle persisted");
  ok(await page.isChecked("text=Keep forever"), "cache TTL 'keep forever' persisted (0)");
  ok((await page.inputValue("textarea")).split("\n").length === 2, "library folders persisted");
  // restore defaults
  await page.uncheck("text=Allow unsynchronized lyrics"); await page.uncheck("text=Keep forever");
  await page.fill('input[type="text"] >> nth=0', "de"); await page.fill("textarea", "");
  await page.click('button:has-text("Save settings")'); await page.waitForSelector("text=Saved");

  console.log("[song page: upload lyrics, timing]");
  await page.request.patch(B + "api/songs/2", { data: { lyrics_offset: 0 } }); // keep the script repeatable
  await page.goto(B + "#/songs/2");
  await page.waitForSelector("text=/Find lyrics|Use different lyrics/");
  await page.setInputFiles('input[type="file"][accept*=".lrc"]', { name: "x.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:01.00] Erste Zeile hier\n[00:06.00] Zweite Zeile dort\n[00:12.00] Dritte Zeile noch") });
  await page.waitForSelector(".lyric-line");
  ok((await page.$$(".lyric-line")).length === 3, "uploaded lyrics appear as 3 lines");
  await page.click('button:has-text("Later")'); await page.click('button:has-text("Later")'); await page.click('button:has-text("Later")');
  ok((await page.textContent(".offset-value")).includes("+0.3"), "offset nudged to +0.3 s");
  await page.click('button:has-text("Save timing")'); await page.waitForSelector("text=Saved");
  await page.reload(); await page.waitForSelector(".offset-value");
  ok((await page.textContent(".offset-value")).includes("+0.3"), "offset persisted");
  await page.screenshot({ path: "shots/12-song-with-lyrics.png" });
  await page.goto(B); await page.waitForSelector(".song");
  ok((await page.textContent(".song:has-text(\"Anderes Lied\")")).includes("Lyrics ready"), "library now shows 'Lyrics ready' for the second song");

  console.log("[game: resume after reload, finish]");
  await page.click('.song >> nth=0 >> button:has-text("Play")');
  await page.click('.segmented button:has-text("Easy")');
  await page.click('button:has-text("Start new game")');
  await page.waitForSelector(".prompt");
  const url = page.url();
  await page.keyboard.press("1"); await page.waitForTimeout(1400);
  await page.keyboard.press("2"); await page.waitForTimeout(1400);
  await page.reload(); await page.waitForSelector(".prompt");
  ok(/Question 3 of/.test(await page.textContent(".prompt-count")), "after a reload the game resumes at the first open question: " + (await page.textContent(".prompt-count")));
  const marks = await page.$$eval(".sheet-line .mark", (e) => e.map((x) => x.textContent));
  ok(marks.filter((m) => m !== "○").length >= 1 && marks.includes("○"), "answered lines keep their results: " + marks.slice(0, 4).join(" "));
  const total = (await page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()))).questions.length;
  for (let i = 2; i < total; i++) { await page.keyboard.press("3"); await page.waitForTimeout(1250); }
  await page.waitForSelector(".notice.ok");
  ok(/Finished: \d+ of \d+ correct/.test(await page.textContent(".notice.ok")), await page.textContent(".notice.ok"));
  await page.screenshot({ path: "shots/13-finished.png" });
  await page.goto(B); await page.waitForSelector(".song");
  await page.click('.song >> nth=0 >> button:has-text("Play")');
  await page.waitForSelector(".past-games li");
  ok((await page.textContent(".past-games")).includes("finished"), "past games list shows the finished game");
  await page.screenshot({ path: "shots/14-library-past-games.png" });

  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.goto(url); await m.waitForSelector(".prompt");
  await m.screenshot({ path: "shots/15-mobile-game.png" });
  await m.goto(B + "#/songs/1"); await m.waitForSelector(".lyric-line");
  await m.screenshot({ path: "shots/16-mobile-song.png" });
  await browser.close();
  console.log(process.exitCode ? "FAILED" : "ALL FLOW CHECKS PASSED");
})();
