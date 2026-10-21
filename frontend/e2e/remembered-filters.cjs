// The filters of every page are remembered in cookies and are still there after a reload (and in a new tab of the same browser).
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/remembered-filters.cjs   (stack as in duplicates.cjs; dictionary words are added through games)
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt"];
const lrc = LINES.map((t, i) => `[00:${String(i * 5).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, p, d) => (await page.request.fetch(B + "api/" + p, { method: m, ...(d ? { data: d } : {}) })).json();
  const song = await (await page.request.post(B + "api/songs", { multipart: { file: { name: "Band - Lied.wav", mimeType: "audio/wav", buffer: wav(25, 5) } } })).json();
  await page.request.post(B + `api/songs/${song.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  await page.request.post(B + "api/songs", { multipart: { file: { name: "Other - Thing.wav", mimeType: "audio/wav", buffer: wav(5, 9) } } });
  const g = await api("POST", "games", { song_id: song.id, difficulty: "expert", mode: "typing" });
  for (const q of g.questions) await api("POST", `games/${g.public_id}/answers`, { question_id: q.id, text: "zzz" });
  await page.waitForTimeout(500);

  console.log("[library]");
  await page.goto(B); await page.waitForSelector(".song");
  await page.click('.chips button:has-text("Needs lyrics")');
  await page.fill('input[type="search"]', "thing");
  await page.click(".regex-toggle");
  await page.reload(); await page.waitForSelector(".song");
  const pressed = await page.$$eval(".toolbar .chips .chip[aria-pressed=true]", (c) => c.map((x) => x.textContent.trim()));
  ok(pressed.some((t) => t.startsWith("Needs lyrics")), "the status filter is still 'Needs lyrics': " + pressed.join(", "));
  ok((await page.inputValue('input[type="search"]')) === "thing" && (await page.getAttribute(".regex-toggle", "aria-pressed")) === "true", "the search text and the regex switch are remembered");
  const tab = await ctx.newPage(); await tab.goto(B); await tab.waitForSelector(".song");
  ok((await tab.inputValue('input[type="search"]')) === "thing", "a new tab starts with the same filters");
  await tab.close();
  ok(/chorus_lib_status=/.test(await page.evaluate(() => document.cookie)), "it is a cookie, as asked");

  console.log("[dictionary]");
  await page.goto(B + "#/dictionary"); await page.waitForSelector(".word");
  await page.click('.chips button:has-text("New")');
  await page.fill('input[type="search"]', "ich");
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForSelector(".word");
  ok((await page.$$eval(".toolbar .chip[aria-pressed=true]", (c) => c.map((x) => x.textContent.trim()))).some((t) => t.startsWith("New")), "the status chip is remembered");
  ok((await page.inputValue('input[type="search"]')) === "ich", "the search is remembered and applied");
  await page.click('.lang-chips .chip:has-text("German")');
  await page.reload(); await page.waitForSelector(".word");
  ok((await page.getAttribute('.lang-chips .chip:has-text("German")', "aria-pressed")) === "true", "the language filter is remembered");

  console.log("[the review uses only the filtered words]");
  const matching = (await api("GET", "dictionary?status=new&language=de&q=ich&limit=500")).items.map((e) => e.surface);
  const everyone = (await api("GET", "dictionary?limit=500")).total;
  ok(matching.length > 0 && matching.length < everyone, `the filters show ${matching.length} of ${everyone} words`);
  await page.goto(B + "#/dictionary"); await page.waitForSelector(".word");
  await page.click('a:has-text("Review")'); await page.waitForSelector(".review-start");
  const note = await page.textContent(".review-start .hint");
  ok(/New/.test(note) && /German/.test(note) && /ich/.test(note), "the review says which filters it uses: " + note.trim().slice(0, 90));
  await page.click('button:has-text("Start")'); await page.waitForSelector(".review-word");
  const seen = [];
  for (let i = 0; i < matching.length + 3; i++) {
    seen.push(await page.textContent(".review-word"));
    await page.keyboard.press("3"); await page.waitForSelector(".review-back");
    await page.keyboard.press("Enter");
    if (await page.$(".review-start")) break;
    await page.waitForSelector(".review-card:not(.review-back) .rate, .review-start");
    if (await page.$(".review-start")) break;
  }
  ok(seen.length === matching.length && seen.every((w) => matching.includes(w)), `exactly the ${matching.length} filtered words were reviewed: ${seen.join(", ")}`);
  await page.waitForSelector(".review-start");
  ok(/Session complete/.test(await page.textContent(".review-start")), "the session ends when the filtered words are done");
  await page.click('button:has-text("Review all words")');
  ok(!(await page.$(".review-start .hint button:has-text('Review all words')")), "'Review all words' drops the filter note");
  ok((await page.inputValue('input[type="search"]').catch(() => "x")) !== "ich", "and the dictionary filters are reset");
  await page.goto(B + "#/dictionary"); await page.waitForSelector(".word");
  ok((await page.inputValue('input[type="search"]')) === "", "the dictionary page shows no filter any more");

  console.log("[scores and review]");
  await page.goto(B + "#/scores"); await page.waitForSelector("h1");
  await page.click('.segmented button:has-text("Type")');
  await page.reload(); await page.waitForSelector("h1");
  ok((await page.getAttribute('.segmented button:has-text("Type")', "aria-pressed")) === "true", "the scores page keeps the Type board");
  await page.goto(B + "#/dictionary/review"); await page.waitForSelector(".review-start");
  await page.click('.review-start .chip:has-text("60")');
  await page.reload(); await page.waitForSelector(".review-start");
  ok((await page.getAttribute('.review-start .chip:has-text("60")', "aria-pressed")) === "true", "the review size is remembered");

  console.log("[a remembered language that is gone]");
  await ctx.addCookies([{ name: "chorus_lib_language", value: encodeURIComponent('"xx"'), url: B }]);
  await page.goto(B); await page.waitForSelector(".song");
  ok((await page.$$(".song")).length >= 1, "a remembered language that no song has any more does not leave an empty library");
  await browser.close();
  console.log(process.exitCode ? "FAILED" : "ALL REMEMBERED-FILTER CHECKS PASSED");
})();
