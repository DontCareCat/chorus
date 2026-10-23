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
  const fire = (type, x, y, sel) => ph.evaluate(([t, x, y, sel]) => { const el = document.querySelector(sel); /* a touch keeps its first target, like the browser does */ el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", clientX: x, clientY: y, isPrimary: true })); }, [type, x, y, sel]);
  const row = ph.locator(".song", { hasText: `Qb ${stamp}` });
  const box = await row.boundingBox();
  const sel = `.song[data-song-id="${songs[1].id}"] .song-text`;
  await fire("pointerdown", 100, box.y + 30, sel);
  for (let i = 1; i <= 6; i++) { await fire("pointermove", 100 + i * 25, box.y + 32, sel); await ph.waitForTimeout(15); }
  ok((await row.getAttribute("data-swipe")) === "right", "dragging a row to the right shows the Add to queue strip");
  await fire("pointerup", 250, box.y + 32, sel);
  await ph.waitForSelector(".queue-bar");
  ok((await ph.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).items.length)) === 1, "past the threshold the song is added");
  await ph.waitForTimeout(300);
  ok(!(await row.getAttribute("data-swipe")), "and the row springs back");
  await ph.click('.queue-bar button[aria-label="Open queue"]');
  await ph.waitForSelector(".queue-row");
  ok((await ph.locator(".queue-row .grip").count()) === 0 && (await ph.locator(".queue-level").count()) === 0, "touch rows have no grip and no dropdown (the ⋮ sheet instead)");
  await ph.locator(".queue-row .kebab").click();
  await ph.waitForSelector(".song-sheet");
  ok((await ph.locator(".song-sheet [role=menuitem]").allInnerTexts()).some((t) => /Difficulty/.test(t)), "the row sheet has Difficulty");
  await browser.close();
})();
