// The play queue (guide sections 19-20): add from the menu, Play all / Shuffle, the bar, the list (reorder, difficulty, remove, bulk menu), Settings default, swipes on touch.
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/queue.cjs
const { chromium, devices } = require("playwright");
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
  page.on("dialog", (d) => d.accept());
  const api = async (m, p, d) => { const r = await page.request.fetch(B + "api/" + p, { method: m, ...(d ? { data: d } : {}) }); return r.status() === 204 ? null : r.json(); };
  const stamp = Date.now() % 100000;
  const songs = [];
  for (const [i, n] of ["Qa", "Qb", "Qc", "Qd"].entries()) {
    const s = await (await page.request.post(B + "api/songs", { multipart: { file: { name: `QBand - ${n} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(25, 2003 + i * 97 + stamp * 11) } } })).json();
    if (i < 3) await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
    songs.push(s);
  }
  const q = `Q[abcd] ${stamp}`;
  const openMenu = async (p, title) => { await p.locator(".song", { hasText: title }).locator(".kebab").evaluate((el) => el.click()); await p.waitForSelector(".song-menu, .sheet"); }; // a DOM click: Playwright's own scroll would close the menu
  const filter = async (p) => { await p.fill('input[type="search"]', `QBand ${stamp}`); await p.waitForFunction(() => document.querySelectorAll(".song").length === 4); };

  await page.goto(B); await page.waitForSelector(".song"); await filter(page);
  console.log("[add from the menu]");
  await page.evaluate(() => sessionStorage.clear());
  await openMenu(page, `Qb ${stamp}`);
  await page.locator('[role=menuitem]:has-text("Add to queue")').click();
  await page.waitForSelector(".queue-bar");
  await page.waitForFunction((t) => document.querySelector(".queue-bar strong")?.textContent.includes(t), `Qb ${stamp}`);
  ok(true, "the bar shows the next song");
  ok(/1st in queue/.test(await page.locator(".queue-bar small").first().innerText()), "and says where it went");
  await openMenu(page, `Qb ${stamp}`);
  await page.locator('[role=menuitem]:has-text("Add to queue")').click();
  await page.waitForTimeout(200);
  ok(/Already in the queue/.test(await page.locator(".queue-bar small").first().innerText()), "adding twice is refused politely");

  console.log("[shuffle]");
  await page.click('.queue-actions button:has-text("Shuffle")');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")));
  ok(st.items.length === 3 && st.items.every((i) => i.difficulty === "progressive"), "Shuffle queues the 3 songs that have lyrics (the 4th is left out), progressive by default");
  ok(/left out/.test(await page.locator(".queue-bar small").first().innerText()), "and says one was left out");
  await page.reload(); await page.waitForSelector(".queue-bar");
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.length)) === 3, "the queue survives a reload");

  console.log("[the list]");
  await page.click('.queue-bar button[aria-label="Open queue"]');
  await page.waitForSelector(".queue-row");
  ok((await page.locator(".queue-row").count()) === 3, "three rows");
  const widths = await page.$$eval(".queue-level .select-btn", (e) => e.map((x) => Math.round(x.getBoundingClientRect().width)));
  ok(new Set(widths).size === 1 && widths[0] >= 150, "every difficulty chip has the same width: " + widths.join());
  ok((await page.locator(".queue-row .level-stars").count()) === 3, "progressive rows carry the two stars");
  await page.locator(".queue-row").nth(0).locator(".select-btn").click();
  await page.locator(".select-list [role=option]", { hasText: "Expert" }).click();
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.filter((i) => i.difficulty === "expert").length)) === 1, "one song's difficulty is set on its own");
  ok((await page.locator(".queue-row").nth(0).locator(".level-stars").count()) === 0, "a set level loses the stars");
  await page.click('.queue-toolbar button[aria-label="Queue menu"]');
  await page.click('[role=menuitem]:has-text("Difficulty for all")');
  await page.click('[role=menuitemradio]:has-text("Hard")');
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.every((i) => i.difficulty === "hard"))), "Difficulty for all changes every waiting song");
  ok((await page.locator(".toast").count()) === 1, "with an Undo toast");
  await page.click('.toast button:has-text("Undo")');
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.filter((i) => i.difficulty === "hard").length)) === 0, "Undo brings the old levels back");
  await page.click('.queue-toolbar button[aria-label="Queue menu"]');
  await page.click('[role=menuitem]:has-text("Mode for all")');
  await page.locator('[role=menuitemradio]').filter({ hasText: /Type|Typing/ }).first().click();
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.every((i) => i.mode === "typing"))), "Mode for all");
  const before = (await page.$$eval(".queue-row strong", (e) => e.map((x) => x.textContent))).join();
  const g = await page.locator(".queue-row").nth(0).locator(".grip").boundingBox();
  const t = await page.locator(".queue-row").nth(2).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + 4, g.y + 50, { steps: 4 }); await page.mouse.move(g.x + 4, t.y + t.height - 8, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const after = (await page.$$eval(".queue-row strong", (e) => e.map((x) => x.textContent))).join();
  ok(before !== after && after.split(",")[2] === before.split(",")[0], "dragging a row reorders the queue: " + after);
  await page.locator(".queue-row").nth(1).locator('button[aria-label="Remove from queue"]').click();
  await page.waitForTimeout(200);
  ok((await page.locator(".queue-row").count()) === 2, "the cross removes a song");
  await page.click('.toast button:has-text("Undo")');
  ok((await page.locator(".queue-row").count()) === 3, "and Undo puts it back");
  await page.keyboard.press("Escape");

  console.log("[play]");
  await page.click('.queue-bar button[aria-label="Play next"]');
  await page.waitForFunction(() => location.hash.startsWith("#/games/"));
  const games = await api("GET", "games");
  ok(games.length >= 1 && games[0].mode === "typing", "the game starts with the queue's mode: " + games[0]?.mode + "/" + games[0]?.difficulty);
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).cursor)) === 1, "the queue moved on");
  await page.goto(B + "#/");
  await page.waitForSelector(".queue-bar");
  ok(/2 of 3/.test(await page.locator(".queue-bar small").first().innerText()), "back in the library the bar offers the next one");
  await page.click('.queue-bar button[aria-label="Skip to next"]'); await page.click('.queue-bar button[aria-label="Skip to next"]');
  ok((await page.locator(".queue-bar strong").first().innerText()) === "Queue finished", "after the last song the bar says it is finished");
  await page.click('.queue-bar button[aria-label="Close"]');
  await page.waitForTimeout(400);
  ok((await page.locator(".queue-bar").count()) === 0, "Close removes the bar");

  console.log("[settings]");
  await page.goto(B + "#/settings"); await page.waitForSelector(".queue-levels");
  await page.click('.queue-levels button:has-text("Hard")');
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(500);
  ok((await api("GET", "settings")).default_queue_difficulty === "hard", "the default queue difficulty is saved");
  await page.reload(); await page.waitForSelector(".queue-levels");
  await page.goto(B + "#/"); await page.waitForSelector(".song"); await filter(page);
  await openMenu(page, `Qa ${stamp}`);
  await page.locator('[role=menuitem]:has-text("Add to queue")').click();
  await page.waitForSelector(".queue-bar");
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items[0].difficulty)) === "hard", "new entries get the default level");
  await api("PUT", "settings", { ...(await api("GET", "settings")), default_queue_difficulty: "progressive" });

  console.log("[touch]");
  const m = await browser.newContext({ ...devices["iPhone 13"] });
  const ph = await m.newPage();
  ph.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await ph.goto(B); await ph.waitForSelector(".song"); await filter(ph);
  await ph.evaluate(() => sessionStorage.clear());
  // real touch input through the browser's own gesture handling (synthetic pointer events hide a pan that cancels the swipe)
  const cdp = await m.newCDPSession(ph);
  const row = ph.locator(".song", { hasText: `Qb ${stamp}` });
  await row.scrollIntoViewIfNeeded(); await ph.waitForTimeout(200);
  const box = await row.boundingBox();
  const ty = box.y + 30;
  const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: ty }] });
  await touch("touchStart", 60);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", 60 + i * 25); await ph.waitForTimeout(20); }
  ok((await row.getAttribute("data-swipe")) === "right", "dragging a row to the right shows the Add to queue strip");
  await touch("touchEnd", 260);
  await ph.waitForSelector(".queue-bar");
  ok((await ph.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.length)) === 1, "past the threshold the song is added");
  await ph.waitForTimeout(300);
  ok(!(await row.getAttribute("data-swipe")), "and the row springs back");
  const barBtns = await ph.locator(".queue-bar button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  ok(barBtns.includes("Play next") && !barBtns.includes("Stop queue") && !barBtns.includes("Skip to next"), "the phone bar keeps Play only (no stop or skip button): " + barBtns.join(", "));
  const bt = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: by }] });
  const cursor = () => ph.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).cursor);
  { // a second song, added by swiping its row (the store keeps the queue in memory, so sessionStorage cannot be edited behind its back)
    const other = ph.locator(".song", { hasText: `Qc ${stamp}` });
    await other.scrollIntoViewIfNeeded(); await ph.waitForTimeout(200);
    const ob = await other.boundingBox(), oy = ob.y + 30;
    const ot = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: oy }] });
    await ot("touchStart", 60); for (let i = 1; i <= 8; i++) { await ot("touchMove", 60 + i * 25); await ph.waitForTimeout(20); } await ot("touchEnd", 260); await ph.waitForTimeout(400);
  }
  const bx = await ph.locator(".queue-bar").boundingBox(), by = bx.y + bx.height / 2;
  const cur0 = await cursor();
  await bt("touchStart", 300); for (let i = 1; i <= 5; i++) { await bt("touchMove", 300 - i * 25); await ph.waitForTimeout(20); }
  const mid = await ph.evaluate(() => { const v = document.querySelector(".queue-bar-view").getBoundingClientRect(), a = document.querySelector(".qb-panel.after"), r = a.getBoundingClientRect(); return { shown: r.left < v.right - 20 && r.left > v.left, text: a.textContent, bar: document.querySelector(".queue-bar").textContent }; });
  ok(mid.shown && mid.text.includes(`Qc ${stamp}`), "while the finger moves, the next song slides in beside the current one: " + mid.text.slice(0, 40));
  ok(!/Next song|Previous song/.test(mid.bar), "with no extra label about it");
  for (let i = 6; i <= 8; i++) { await bt("touchMove", 300 - i * 25); await ph.waitForTimeout(20); }
  await bt("touchEnd", 100); await ph.waitForTimeout(450);
  ok((await cursor()) === cur0 + 1, "a swipe left on the bar skips to the next song");
  ok((await ph.locator(".queue-bar-strip").evaluate((e) => e.style.transform)) === "" && (await ph.locator(".queue-bar .qb-panel").first().innerText()).length > 0, "and the strip is back at rest showing the new song");
  await bt("touchStart", 60); for (let i = 1; i <= 8; i++) { await bt("touchMove", 60 + i * 25); await ph.waitForTimeout(20); } await bt("touchEnd", 260); await ph.waitForTimeout(300);
  ok((await cursor()) === cur0, "a swipe right takes it back");
  await ph.tap(".queue-bar-face"); await ph.waitForSelector(".queue-row");
  ok(true, "a tap on the bar opens the queue");
  await ph.keyboard.press("Escape"); await ph.waitForTimeout(400);
  if (await ph.locator(".queue-row").count()) await ph.evaluate(() => document.querySelector(".sheet .grab, .dialog-scrim")?.click());
  await ph.waitForTimeout(400);
  const sortBtn = await ph.locator(".sort-control .select-btn").evaluate((b) => ({ text: b.textContent.trim(), w: b.getBoundingClientRect().width, hasSvg: !!b.querySelector("svg") }));
  ok(sortBtn.text === "" && sortBtn.hasSvg && sortBtn.w <= 48, "on a phone the sort button is an icon: " + JSON.stringify(sortBtn));
  const line = await ph.evaluate(() => { const a = document.querySelector(".queue-actions").getBoundingClientRect(), s = document.querySelector(".sort-control").getBoundingClientRect(); return { sameLine: Math.abs((a.top + a.bottom) / 2 - (s.top + s.bottom) / 2) < 8, fits: s.right <= innerWidth }; });
  ok(line.sameLine && line.fits, "and it sits on the line of Play all and Shuffle: " + JSON.stringify(line));
  await ph.click('.queue-bar button[aria-label="Open queue"]');
  await ph.waitForSelector(".queue-row");
  ok((await ph.locator(".queue-row .grip").count()) === 0 && (await ph.locator(".queue-level").count()) === 0, "touch rows have no grip and no dropdown (the ⋮ sheet instead)");
  await ph.locator(".queue-row .kebab").first().click();
  await ph.waitForSelector(".song-sheet");
  ok((await ph.locator(".song-sheet [role=menuitem]").allInnerTexts()).some((t) => /Difficulty/.test(t)), "the row sheet has Difficulty");
  await browser.close();
})();
