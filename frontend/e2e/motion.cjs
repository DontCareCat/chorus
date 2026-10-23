// Motion (design guide section 16): sliding thumbs, sheets with a draggable handle, the rolling phone menu, outside taps,
// auto-scroll of the play options, plain marks, header buttons. Isolated stack: backend :18201, fake-lrclib.py not needed.
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/motion.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const LRC = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt"].map((t, i) => `[00:${String(i * 5).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  for (let i = 0; i < 9; i++) {
    const s = await (await page.request.post(B + "api/songs", { multipart: { file: { name: `Band${i} - Lied ${i}.wav`, mimeType: "audio/wav", buffer: wav(25, 3 + i) } } })).json();
    await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(LRC) } } });
  }
  await page.goto(B); await page.waitForSelector(".song");
  const thumb = (sel) => page.evaluate((q) => { const g = document.querySelector(q); const c = getComputedStyle(g, "::before"); return { x: parseFloat(g.style.getPropertyValue("--thumb-x")), w: parseFloat(g.style.getPropertyValue("--thumb-w")), d: c.transitionDuration, state: g.dataset.thumb }; }, sel);
  const offs = (sel, text) => page.evaluate(([q, t]) => { const b = [...document.querySelector(q).children].find((x) => x.textContent.includes(t)); return { x: b.offsetLeft, w: b.offsetWidth }; }, [sel, text]);

  console.log("[library tabs, logo, expanding panels]");
  const tabX = () => page.evaluate(() => { const n = document.querySelector(".library-tabs"); return n ? new DOMMatrix(getComputedStyle(n, "::before").transform).m41 : null; });
  const tabFrames = page.evaluate(async () => { const xs = []; const t0 = performance.now(); while (performance.now() - t0 < 400) { const n = document.querySelector(".library-tabs"); if (n && n.dataset.thumb) xs.push(new DOMMatrix(getComputedStyle(n, "::before").transform).m41); await new Promise((r) => requestAnimationFrame(r)); } return xs; });
  await page.evaluate(() => [...document.querySelectorAll(".library-tabs a")].find((a) => a.getAttribute("aria-current") !== "page").click());
  const xs = await tabFrames;
  ok(xs.length > 4 && xs[0] < 20 && xs[xs.length - 1] > 80 && xs.filter((x) => x > xs[0] + 2 && x < xs[xs.length - 1] - 2).length >= 2, "Songs | Playlists: the thumb glides from the old tab to the new one across the page change: " + xs.slice(0, 8).map((x) => x.toFixed(0)).join(","));
  await page.goto(B); await page.waitForSelector(".song");
  await page.click(".wordmark");
  const bars = await page.evaluate(async () => { const f = []; const t0 = performance.now(); while (performance.now() - t0 < 700) { f.push([...document.querySelectorAll(".bars i")].map((i) => new DOMMatrix(getComputedStyle(i).transform).d)); await new Promise((r) => requestAnimationFrame(r)); } return f; });
  const low = (k) => bars.findIndex((f) => f[k] < 0.4);
  ok(low(0) >= 0 && low(1) > low(0) && low(2) > low(1) && bars[bars.length - 1].every((d) => d > 0.99), "a click on the logo: the bars shrink one after another and spring back to full size");
  const grow = await page.evaluate(async () => { document.querySelector(".play-btn:not(:disabled)").click(); const h = []; const t0 = performance.now(); while (performance.now() - t0 < 300) { const e = document.querySelector(".expand"); if (e) h.push(e.getBoundingClientRect().height); await new Promise((r) => requestAnimationFrame(r)); } return h; });
  ok(grow.length > 4 && grow[0] < grow[grow.length - 1] * 0.5 && grow.some((h) => h > grow[0] + 5 && h < grow[grow.length - 1] - 5), "the play options grow open instead of appearing: " + grow.slice(0, 6).map((h) => h.toFixed(0)).join(","));

  console.log("[sliding thumbs, desktop]");
  let t = await thumb(".topbar > nav");
  const lib = await offs(".topbar > nav", "Library");
  ok(t.x === lib.x && t.w === lib.w, "the menu thumb sits on the current page: " + JSON.stringify(t));
  await page.click('.topbar > nav a:has-text("Scores")'); await page.waitForTimeout(500);
  t = await thumb(".topbar > nav"); const sc = await offs(".topbar > nav", "Scores");
  ok(t.x === sc.x && t.w === sc.w && parseFloat(t.d) >= 0.2, "and slides to the next one (width follows, " + t.d + " transition)");
  await page.goto(B); await page.waitForSelector(".song");
  await page.click('.toolbar .chips .chip:has-text("Needs lyrics")').catch(() => {});
  await page.click('.toolbar .chips .chip:has-text("Lyrics ready")'); await page.waitForTimeout(500);
  t = await thumb(".toolbar .chips"); const chip = await offs(".toolbar .chips", "Lyrics ready");
  ok(t.x === chip.x && t.w === chip.w && t.state === "glide", "the filter chips share one thumb that moves to the chosen chip");
  await page.click(".song-main >> nth=0 >> .play-btn"); await page.waitForSelector(".start-panel");
  await page.click('.start-panel .mode-switch button:has-text("Type")'); await page.waitForTimeout(500);
  t = await thumb(".start-panel .mode-switch"); const ty = await offs(".start-panel .mode-switch", "Type");
  ok(t.x === ty.x && t.w === ty.w, "the game mode control slides its thumb as well");
  const cen = await page.evaluate(() => { const b = document.querySelector('.start-panel .mode-switch button'); return getComputedStyle(b).textAlign; });
  ok(cen === "center", "option text is centred");
  ok(await page.evaluate(() => { const e = document.createElement("span"); e.className = "lw-word"; e.dataset.state = "correct"; document.body.append(e); const c = getComputedStyle(e, "::after").content; e.remove(); return c === "none" || c === "normal"; }), "the lyric marks are no text glyphs any more");
  ok((await page.$$(".account a.btn")).length >= 1, "Sign in / Create account are buttons");

  console.log("[phone]");
  const phone = await browser.newContext({ ...devices["Pixel 7"], hasTouch: true });
  const p = await phone.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(B); await p.waitForSelector(".song");
  await p.tap(".menu-btn"); await p.waitForTimeout(400);
  const open = await p.evaluate(() => ({ state: document.querySelector(".menu-panel")?.dataset.state, b2: getComputedStyle(document.querySelector(".burger .b2")).opacity, expanded: document.querySelector(".menu-btn").getAttribute("aria-expanded") }));
  ok(open.state === "open" && open.expanded === "true" && parseFloat(open.b2) < 0.1, "the menu rolls down and the bars turn into a cross: " + JSON.stringify(open));
  const rowBefore = await p.evaluate(() => document.querySelectorAll(".start-panel").length);
  await p.tap(".song-main >> nth=4 >> .song-text"); await p.waitForTimeout(500);
  ok((await p.$$(".menu-panel")).length === 0 && (await p.evaluate(() => document.querySelectorAll(".start-panel").length)) === rowBefore, "a tap outside closes the menu and opens nothing underneath");
  const closed = await p.evaluate(() => getComputedStyle(document.querySelector(".burger .b2")).opacity);
  ok(parseFloat(closed) === 1, "the bars come back");

  // song sheet
  await p.tap(".song-main >> nth=0 >> .kebab"); await p.waitForSelector(".sheet");
  await p.waitForTimeout(450);
  const st = await p.evaluate(() => { const s = document.querySelector(".sheet"); const r = s.getBoundingClientRect(); return { state: s.dataset.state, bottom: Math.round(r.bottom), vh: innerHeight }; });
  ok(st.state === "open" && st.bottom === st.vh, "the sheet rolled up to the bottom edge: " + JSON.stringify(st));
  await p.tap(".sheet .grab"); await p.waitForTimeout(500);
  ok((await p.$$(".sheet")).length === 0, "a tap on the handle closes it");
  await p.tap(".song-main >> nth=0 >> .kebab"); await p.waitForSelector(".sheet"); await p.waitForTimeout(450);
  await p.tap(".sheet-scrim", { position: { x: 20, y: 40 } }); await p.waitForTimeout(500);
  ok((await p.$$(".sheet")).length === 0 && (await p.$$(".start-panel")).length === 0, "a tap on the dimmed area closes it and does not open the song underneath");
  // drag
  const cdp = await phone.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const grab = async () => { const b = await p.locator(".sheet .grab").boundingBox(); return { x: b.x + b.width / 2, y: b.y + 20 }; };
  await p.tap(".song-main >> nth=0 >> .kebab"); await p.waitForSelector(".sheet"); await p.waitForTimeout(450);
  let g = await grab();
  await touch("touchStart", g.x, g.y); for (let i = 1; i <= 4; i++) { await touch("touchMove", g.x, g.y + i * 8); await p.waitForTimeout(30); }
  const dragged = await p.evaluate(() => document.querySelector(".sheet").style.transform);
  await touch("touchEnd"); await p.waitForTimeout(500);
  ok(/translateY\(\d+px\)/.test(dragged) && (await p.$$(".sheet")).length === 1, "a short drag follows the finger and springs back: " + dragged);
  g = await grab();
  await touch("touchStart", g.x, g.y); for (let i = 1; i <= 6; i++) { await touch("touchMove", g.x, g.y + i * 50); await p.waitForTimeout(30); }
  await touch("touchEnd"); await p.waitForTimeout(600);
  ok((await p.$$(".sheet")).length === 0, "a long drag rolls the sheet away");

  // auto-scroll of the play options
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(200);
  const last = p.locator(".song-main").last();
  await last.locator(".song-text").tap(); await p.waitForTimeout(900);
  const view = await p.evaluate(() => { const li = [...document.querySelectorAll("li.song")].pop(); const m = li.querySelector(".song-main").getBoundingClientRect(), pa = li.querySelector(".start-panel")?.getBoundingClientRect(); return { top: m.top, bottom: pa?.bottom, vh: innerHeight, panel: !!pa }; });
  ok(view.panel && view.bottom <= view.vh + 1 && view.top >= 0, "the opened play options are scrolled into view: " + JSON.stringify(view));
  await phone.close(); await browser.close();
})();
