// The typing game on a phone while the on-screen keyboard is open: Android Chrome / iOS keep the page at full height, shrink
// the VISUAL viewport and pan it to the focused field, which pushed the top of the screen (the question) out of view.
// The test stands in for the keyboard with a stub of window.visualViewport (headless Chromium has no keyboard) and checks that
// the whole game screen (header, question, field, player) sits inside the visible area, and goes back when the keyboard closes.
// Stack as in typing-mode.cjs:  CHORUS_URL=http://localhost:18201/ node frontend/e2e/keyboard-fit.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * 37) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt", "Ich liebe meine kleine Wohnung sehr", "Der Mond steht hoch am Himmel heute"];
const lrc = LINES.map((t, i) => `[00:${String(i * 5).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    const vv = new EventTarget();
    Object.assign(vv, { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    window.__kb = (height, offsetTop) => { vv.height = height; vv.offsetTop = offsetTop; vv.dispatchEvent(new Event("resize")); };
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const song = await (await ctx.request.post(B + "api/songs", { multipart: { file: { name: "Band - Lied.wav", mimeType: "audio/wav", buffer: wav(40) } } })).json();
  await ctx.request.post(B + `api/songs/${song.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const game = await (await ctx.request.post(B + "api/games", { data: { song_id: song.id, difficulty: "medium", mode: "typing" } })).json();
  await page.goto(B + "#/games/" + game.public_id);
  await page.waitForSelector(".typing textarea");

  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null; }, sel);
  const meta = await page.getAttribute('meta[name="viewport"]', "content");
  ok(/interactive-widget=resizes-content/.test(meta), "the viewport asks browsers to resize the page for the keyboard: " + meta);

  console.log("[keyboard closed]");
  const full = await page.evaluate(() => innerHeight);
  let shell = await rect(".shell");
  ok(Math.abs(shell.bottom - shell.top - full) < 2 && !(await page.evaluate(() => document.documentElement.classList.contains("kb-open"))), `the screen is as tall as the page (${full}px)`);

  console.log("[keyboard open: visible area 150..620, panned by the browser]");
  await page.evaluate(() => window.__kb(470, 150));
  await page.waitForFunction(() => document.documentElement.classList.contains("kb-open"));
  shell = await rect(".shell");
  ok(Math.abs(shell.top - 150) < 1.5 && Math.abs(shell.bottom - 620) < 1.5, `the screen fills the visible area: ${shell.top.toFixed(0)}..${shell.bottom.toFixed(0)}`);
  for (const [sel, what] of [[".game-bar", "the header with the song title"], [".lyric-window", "the lyric window with the open question"], [".game-timeline", "the progress line"], [".typing textarea", "the answer field"], [".transport, .player", "the player"]]) {
    const r = await rect(sel);
    ok(r && r.top >= 148 && r.bottom <= 622, `${what} is inside the visible area: ${r ? r.top.toFixed(0) + ".." + r.bottom.toFixed(0) : "missing"}`);
  }
  const m = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: scrollY }));
  ok(m.x <= 0 && m.y === 0, "the page itself did not scroll");
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => document.elementFromPoint(100, 525)?.tagName);
  ok(hit === "TEXTAREA", "a tap on the answer field lands on it: " + hit);
  await page.evaluate(() => { Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true }); }); // the layout stays; Playwright sizes its screenshot from the real one
  await page.screenshot({ path: "/tmp/kb-open.png", clip: { x: 0, y: 0, width: 390, height: 844 } }); // (an explicit clip: Playwright would size the capture from the stubbed visualViewport)

  console.log("[keyboard closes]");
  await page.evaluate(() => window.__kb(innerHeight, 0));
  await page.waitForFunction(() => !document.documentElement.classList.contains("kb-open"));
  shell = await rect(".shell");
  ok(Math.abs(shell.top) < 1 && Math.abs(shell.bottom - full) < 2, "the screen is full height again");
  await browser.close();
  console.log(process.exitCode ? "FAILED" : "ALL KEYBOARD CHECKS PASSED");
})();
