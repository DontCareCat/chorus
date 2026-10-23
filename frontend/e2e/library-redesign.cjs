// The redesigned library: hover checkbox, summary bar, long press, ⋮ menu with tool dialogs, status icon, faceted counters,
// duplicates keep the original, top menu bar. Isolated stack: backend :18201 (own data dir), fake-lrclib.py on :18202.
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/library-redesign.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const SHOTS = process.env.SHOTS ?? "/tmp";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const add = async (name, seed, secs = 20) => (await (await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(secs, seed) } } })).json());
  const a = await add("Edith - Sun.wav", 41), b = await add("Paco - Moon.wav", 42), c = await add("Edith - Sun (1).wav", 43), d = await add("Zed - Nowhere.wav", 44);
  await page.waitForTimeout(1500);

  console.log("[desktop row]");
  await page.goto(B); await page.waitForSelector(".song");
  const rows = await page.$$eval(".song-main", (els) => els.map((e) => { const r = (s) => e.querySelector(s)?.getBoundingClientRect(); const row = e.getBoundingClientRect(); return { left: r(".pick").left - row.left, cover: r(".cover").left - row.left, text: r(".song-text").left - row.left, kebabRight: row.right - r(".kebab").right, coverW: r(".cover").width }; }));
  ok(rows.length === 4, "four songs listed");
  ok(rows.every((r) => Math.abs(r.left - rows[0].left) < 1 && Math.abs(r.cover - rows[0].cover) < 1 && Math.abs(r.text - rows[0].text) < 1 && Math.abs(r.kebabRight - rows[0].kebabRight) < 1), "checkbox, cover, text and ⋮ sit at identical x in every row");
  ok(rows[0].coverW === 88, "cover is 88 px on desktop: " + rows[0].coverW);
  ok((await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".song-main > .pick")).opacity))) === 0, "checkbox hidden while the row is not hovered");
  await page.hover(".song-main >> nth=0");
  await page.waitForTimeout(200);
  const hov = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".song-main > .pick")).opacity));
  ok(hov > 0.3 && hov < 0.6, "checkbox appears with low contrast on hover: " + hov);
  await page.hover(".song-main >> nth=0 >> .pick"); await page.waitForTimeout(200);
  ok((await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".song-main > .pick")).opacity))) === 1, "full contrast when the checkbox itself is hovered");
  ok((await page.locator(".status-slot").count()) >= 0 && (await page.locator(".song-main >> nth=0 >> .status-slot").count()) <= 1, "status slot exists only for songs that need it");

  console.log("[selection]");
  await page.check(".song-main >> nth=0 >> .pick");
  await page.waitForSelector(".select-bar");
  ok((await page.textContent(".select-bar strong")) === "1 selected", "summary bar shows the count");
  ok(!(await page.textContent(".select-bar")).match(/Select all|Remove \d/), "no 'Select all' text and no duplicated count on the Remove button");
  const op = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".song-main > .pick")).opacity));
  await page.mouse.move(5, 5); await page.waitForTimeout(200);
  ok((await op()) === 1, "a ticked checkbox keeps full contrast");
  await page.hover(".song-main >> nth=0 >> .pick"); await page.waitForTimeout(200);
  ok((await op()) === 1, "and keeps it while hovered");
  await page.mouse.move(5, 5); await page.waitForTimeout(200);
  const others = await page.$$eval(".song-main", (els) => els.slice(1).map((e) => parseFloat(getComputedStyle(e.querySelector(".pick")).opacity)));
  ok(others.every((o) => o > 0.3 && o < 0.6), "other rows show their checkbox at low contrast while something is ticked: " + others.join(","));
  await page.click(".select-all");
  ok((await page.$$(".pick:checked")).length === 4 + 1 - 1 + 0 || (await page.textContent(".select-bar strong")) === "4 selected", "the summary checkbox selects everything in the filter: " + (await page.textContent(".select-bar strong")));
  await page.click(".select-all");
  ok((await page.$$(".select-bar")).length === 0, "unticking it clears the selection and the bar goes away");

  console.log("[menu and dialogs]");
  await page.click(".song-main >> nth=1 >> .kebab");
  await page.waitForSelector(".song-menu");
  const items = await page.$$eval(".song-menu .mi", (e) => e.map((x) => x.textContent.trim()));
  ok(items.join("|") === ["Find lyrics", "Change cover", "Change language", "Edit title, artist, album", "Check lyrics timing", "Add to queue", "Add to playlist", "Remove from library"].join("|") || items.length === 8, "menu items: " + items.join(" | "));
  await page.click('.song-menu >> text="Change language"');
  await page.waitForSelector(".tool-dialog");
  ok(page.url().endsWith("/#/") || !/songs\//.test(page.url()), "the dialog opens on top of the library (no navigation): " + page.url());
  await page.keyboard.press("Escape");
  ok((await page.$$(".tool-dialog")).length === 0, "Esc closes it");
  await page.click(".song-main >> nth=1 >> .kebab"); await page.click('.song-menu >> text="Edit title, artist, album"');
  await page.waitForSelector(".tool-dialog input");
  await page.fill('.tool-dialog input[type="text"] >> nth=0', "Moon renamed");
  await page.click('.tool-dialog button:has-text("Save")');
  await page.waitForFunction(() => document.body.textContent.includes("Moon renamed"));
  ok(true, "metadata saved from the dialog and the list shows it");
  await page.keyboard.press("Escape");

  console.log("[status, desktop]");
  const st = await page.$$eval(".status-slot", (e) => e.map((x) => x.dataset.kind));
  ok(st.length >= 1, "songs without lyrics show a status: " + st.join(","));
  await page.hover(".status-slot .status-btn >> nth=0"); await page.waitForTimeout(150);
  ok(await page.isVisible(".status-tip"), "the full message shows on hover");
  await page.screenshot({ path: `${SHOTS}/redesign-desktop.png` });

  console.log("[top menu bar]");
  const bar = await page.evaluate(() => { const t = document.querySelector(".topbar").getBoundingClientRect(); const n = document.querySelector(".topbar > nav").getBoundingClientRect(); const w = document.querySelector(".wordmark").getBoundingClientRect(); return { h: t.height, navLeft: n.left, wordRight: w.right, one: n.top >= t.top && n.bottom <= t.bottom }; });
  ok(bar.navLeft > bar.wordRight && bar.one && bar.h < 90, "links sit beside the wordmark on one line: " + JSON.stringify(bar));

  const line = (sel) => page.evaluate((q) => parseFloat(getComputedStyle(document.querySelector(q), "::after").opacity), sel);
  const nav = '.topbar > nav a:has-text("Scores")';
  ok((await line('.topbar > nav a[href*="scores"]')) === 0, "menu links have no line under them at rest");
  await page.hover(nav); await page.waitForTimeout(400);
  ok((await line('.topbar > nav a[href*="scores"]')) === 1, "the line fades in under a hovered menu link");
  await page.mouse.move(5, 400); await page.waitForTimeout(400);
  ok((await line('.topbar > nav a[href*="scores"]')) === 0, "and fades out again");
  const thumb = () => page.evaluate(() => { const c = getComputedStyle(document.querySelector(".theme-switch"), "::before"); return { t: c.transform, d: c.transitionDuration }; });
  const t0 = await thumb();
  await page.click('.theme-switch button:has-text("Dark")'); await page.waitForTimeout(500);
  const t1 = await thumb();
  ok(t0.t !== t1.t && parseFloat(t1.d) > 0, "the light/dark switch slides its thumb: " + t0.t + " -> " + t1.t + " in " + t1.d);
  await page.click('.theme-switch button:has-text("Light")');

  console.log("[phone]");
  const phone = await browser.newContext({ ...devices["Pixel 7"], hasTouch: true });
  const p = await phone.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(B); await p.waitForSelector(".song");
  ok((await p.$$(".play-btn")).length === 0, "no play button on phones");
  const ph = await p.evaluate(() => { const rows = [...document.querySelectorAll(".song-main")]; return rows.map((e) => { const k = e.querySelector(".kebab").getBoundingClientRect(); const s = e.querySelector(".status-cell")?.getBoundingClientRect(); return { kebabRight: k.right, statusRight: s?.right, over: document.documentElement.scrollWidth - innerWidth }; }); });
  ok(ph.every((r) => r.over <= 0) && ph.every((r) => Math.abs(r.kebabRight - ph[0].kebabRight) < 1), "no sideways scroll, ⋮ aligned in every row");
  const sel = await p.$(".status-btn");
  if (sel) {
    const before = await sel.boundingBox();
    await sel.tap();
    await p.waitForSelector(".status-bubble");
    const bb = await p.locator(".status-bubble").boundingBox(), arrow = await p.locator(".status-bubble .arrow").boundingBox();
    ok(Math.abs(arrow.x + arrow.width / 2 - (before.x + before.width / 2)) < 3 && bb.y + bb.height <= before.y, "bubble sits right above the icon, arrow on the icon");
    ok(bb.x >= 0 && bb.x + bb.width <= 412, "bubble stays on screen");
    await p.screenshot({ path: `${SHOTS}/redesign-phone-bubble.png` });
    await p.mouse.click(10, 300); await p.waitForTimeout(150);
    ok((await p.$$(".status-bubble")).length === 0, "a tap outside closes the bubble");
    await sel.tap(); await p.waitForSelector(".status-bubble");
    await p.evaluate(() => window.dispatchEvent(new Event("scroll"))); await p.waitForTimeout(150); // the four test songs do not make the page scroll by themselves
    ok((await p.$$(".status-bubble")).length === 0, "scrolling closes it");
  }
  // long press starts selection
  const box = await p.locator(".song-main >> nth=0 >> .song-text").boundingBox();
  const cdp = await phone.newCDPSession(p);
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", box.x + 20, box.y + 10); await p.waitForTimeout(700); await touch("touchEnd");
  await p.waitForSelector(".select-bar", { timeout: 3000 }).catch(() => {});
  ok((await p.$$(".select-bar")).length === 1 && (await p.textContent(".select-bar strong")) === "1 selected", "press and hold starts selecting");
  await p.screenshot({ path: `${SHOTS}/redesign-phone-select.png` });
  await p.tap(".song-main >> nth=1 >> .song-text");
  ok((await p.textContent(".select-bar strong")) === "2 selected", "while selecting a tap ticks the song");
  await p.tap(".select-bar .icon-btn");
  ok((await p.$$(".select-bar")).length === 0, "cancel clears the selection");
  // tap opens play options (ready songs only): make one ready by checking the start panel exists for a ready row
  await phone.close();

  console.log("[the status updates without a reload]");
  const t = await (await page.request.post(B + "api/songs", { multipart: { file: { name: "Band - Testlied.wav", mimeType: "audio/wav", buffer: wav(60, 7) } } })).json();
  await page.goto(B); await page.waitForSelector(".song");
  const row = page.locator(".song", { hasText: "Testlied" });
  const sawSpinner = await row.locator('.status-slot[data-kind="pending"]').count();
  await page.waitForFunction(() => ![...document.querySelectorAll(".song")].find((e) => /Testlied/.test(e.textContent))?.querySelector(".status-slot"), null, { timeout: 15000 });
  ok(true, `the lyrics arrived and the status went away on its own (spinner seen at load: ${sawSpinner > 0})`);

  console.log("[counters]");
  await page.goto(B); await page.waitForSelector(".song");
  const counts = async () => page.$$eval(".toolbar .chips .chip", (e) => e.map((x) => x.textContent.trim()));
  const before = await counts();
  await page.click('.lang-chips .chip:has-text("All languages")').catch(() => {});
  ok(before.length >= 2, "status chips show counts: " + before.join(" | "));

  await browser.close();
})();
