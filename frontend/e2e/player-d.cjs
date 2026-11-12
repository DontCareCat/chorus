// Beta 0.2.0 group D: the game player (layout B), swipe for next, answers right above the player, the lyric window's focus modes and its smooth scroll.
// Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/player-d.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const syl = ["ba", "ke", "mi", "so", "tu", "la", "ne", "ri", "po", "du"];
const word = (n) => syl[n % 10] + syl[Math.floor(n / 10) % 10] + syl[Math.floor(n / 100) % 10] + "en";
const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false, queue_fade: false });
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${[0, 1, 2, 3, 4].map((k) => word(i * 5 + k + stamp * 3)).join(" ")} und ein langer Satz`).join("\n");
  const song = async (n) => {
    const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `PD - Song ${n} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(70, 3301 + stamp + n) } } })).json();
    await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
    return s;
  };
  const [s1, s2] = [await song(1), await song(2)];
  const mk = (s) => api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });
  const queueOf = (ids) => ({ items: ids.map((songId) => ({ songId, difficulty: "hard", mode: "choice" })), cursor: 0 });

  console.log("[phone: layout B]");
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addInitScript((q) => { if (!sessionStorage.getItem("chorus_queue")) sessionStorage.setItem("chorus_queue", JSON.stringify(q)); }, queueOf([s2.id]));
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const g1 = await mk(s1);
  await ph.goto(B + `#/games/${g1.public_id}`); await ph.waitForSelector(".transport .seek"); await wait(ph, 600);
  const labels = await ph.$$eval(".transport button", (b) => b.map((x) => x.getAttribute("aria-label")));
  ok(!labels.includes("Stop"), "no Stop button: " + labels.join(", "));
  ok(!labels.includes("Skip to next") && (await ph.locator(".transport .volume").count()) === 0, "no Next button and no volume control on a phone");
  ok(labels.includes("Play") && labels.includes("Back 5 seconds") && labels.some((l) => /^Open queue/.test(l ?? "")), "play, rewind 5 s and the queue button remain");
  const times = await ph.$$eval(".transport-time", (e) => e.map((x) => x.textContent));
  ok(times.length === 1 && /^1:10$/.test(times[0]), "only the song length is shown: " + times.join(" / "));
  const L = await ph.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const t = r(".transport"), sk = r(".seek-wrap"), c = r(".transport .controls"), q = r(".transport .queue-btn"), h = r(".swipe-hint"), o = r(".options"); return { tTop: t.top, tBottom: t.bottom, seekBottom: sk.bottom, seekW: sk.width, w: innerWidth, ctrlTop: c.top, qTop: q.top, hintShown: document.querySelector(".swipe-hint").dataset.shown, hintText: document.querySelector(".swipe-hint").textContent, hintMid: (h.left + h.right) / 2, optBottom: o.bottom, scrollW: document.documentElement.scrollWidth }; });
  ok(L.seekBottom <= L.ctrlTop + 1 && L.seekW > L.w * 0.6, `the progress bar is on top and wide (${Math.round(L.seekW)} of ${L.w} px), the controls under it`);
  ok(L.hintShown === "true" && /Swipe for next/.test(L.hintText) && Math.abs(L.hintMid - L.w / 2) < 40, "the swipe hint sits in the middle of the lower row");
  ok(L.tTop - L.optBottom >= 0 && L.tTop - L.optBottom <= 16, `the answers sit directly above the player (${Math.round(L.tTop - L.optBottom)} px gap)`);
  ok(L.scrollW <= L.w, "nothing makes the page wider than the screen");
  await ph.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + "/phone-b.png" : "/dev/null" }).catch(() => undefined);

  // the queue sheet's Skip to next
  await ph.click(".transport .queue-btn"); await ph.waitForSelector(".queue-body");
  await ph.click('.queue-body button[aria-label="Queue menu"]');
  const items = await ph.$$eval('.queue-menu [role="menuitem"]', (e) => e.map((x) => x.textContent.trim()));
  ok(items[0] === "Skip to next", "the queue sheet's menu starts with Skip to next: " + items.join(" | "));
  await ph.keyboard.press("Escape"); await ph.mouse.click(5, 5); await wait(ph, 300);
  if (await ph.locator(".queue-body").count()) await ph.click('.dialog [aria-label="Close"], .queue-body ~ * [aria-label="Close"]').catch(() => undefined);

  // swipe left on the bar = next song
  const cdp = await ctx.newCDPSession(ph);
  const touch = async (y, x0, x1) => {
    const pt = (x) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x0) });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x0 + ((x1 - x0) * i) / 8) }); await wait(ph, 16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  if (await ph.locator(".queue-body").count() === 0) {
    const bar = await ph.locator(".transport .swipe-hint").boundingBox();
    const seek = await ph.locator(".seek-wrap").boundingBox();
    const before = await ph.evaluate(() => location.hash);
    await touch(seek.y + seek.height / 2, 300, 60); await wait(ph, 800);
    ok((await ph.evaluate(() => location.hash)) === before, "a drag that starts on the progress track does not skip the song");
    await touch(bar.y + bar.height / 2, 330, 60);
    await ph.waitForFunction((h) => location.hash !== h, before, { timeout: 8000 }).catch(() => undefined);
    const after = await ph.evaluate(() => location.hash);
    ok(after !== before && /#\/games\//.test(after), `a left swipe on the bar starts the next song (${after})`);
    await ph.waitForSelector(".transport .seek"); await wait(ph, 800);
    ok((await ph.locator(".transport .swipe-hint").getAttribute("data-shown")) === "false", "the hint is gone after the player has swiped");
  } else { ok(false, "the queue sheet could not be closed"); }

  console.log("[phone: the sheet's Skip to next]");
  const g3 = await mk(s1);
  await ph.evaluate((q) => sessionStorage.setItem("chorus_queue", JSON.stringify(q)), queueOf([s2.id]));
  await ph.goto(B + `#/games/${g3.public_id}`); await ph.reload(); await ph.waitForSelector(".transport .seek");
  const h0 = await ph.evaluate(() => location.hash);
  await ph.click(".transport .queue-btn"); await ph.click('.queue-body button[aria-label="Queue menu"]');
  await ph.click('.queue-menu [role="menuitem"]:has-text("Skip to next")');
  await ph.waitForFunction((h) => location.hash !== h, h0, { timeout: 8000 }).catch(() => undefined);
  ok((await ph.evaluate(() => location.hash)) !== h0, "Skip to next in the queue sheet starts the next song");

  console.log("[phone: no queue, no swipe]");
  await ph.evaluate(() => sessionStorage.setItem("chorus_queue", JSON.stringify({ items: [], cursor: 0 })));
  await ph.reload(); await ph.waitForSelector(".transport .seek");
  ok((await ph.locator(".transport .swipe-hint").getAttribute("data-shown")) === "false", "with nothing in the queue the hint is not shown");

  console.log("[PC: wide layout]");
  const pc = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  pc.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await pc.addInitScript((q) => sessionStorage.setItem("chorus_queue", JSON.stringify(q)), queueOf([s2.id]));
  await pc.goto(B + `#/games/${(await mk(s1)).public_id}`); await pc.waitForSelector(".transport .seek"); await wait(pc, 600);
  const pl = await pc.$$eval(".transport button", (b) => b.map((x) => x.getAttribute("aria-label")));
  ok(!pl.includes("Stop") && pl.includes("Skip to next") && pl.includes("Play") && pl.includes("Back 5 seconds"), "play, rewind and Next buttons, no Stop: " + pl.join(", "));
  ok((await pc.locator(".transport .volume").count()) === 1, "the volume control is on the PC bar");
  const row = await pc.evaluate(() => { const t = document.querySelector(".transport-inner").getBoundingClientRect(), ys = [".controls", ".seek-wrap", ".transport-time", ".volume", ".queue-btn"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return (r.top + r.bottom) / 2; }); return { spread: Math.max(...ys) - Math.min(...ys), h: t.height }; });
  ok(row.spread < 6, `one row on a wide screen (centres within ${Math.round(row.spread)} px)`);
  const h1 = await pc.evaluate(() => location.hash);
  await pc.click('.transport button[aria-label="Skip to next"]');
  await pc.waitForFunction((h) => location.hash !== h, h1, { timeout: 8000 }).catch(() => undefined);
  ok((await pc.evaluate(() => location.hash)) !== h1, "the Next button starts the next song");

  console.log("[phone landscape: one row]");
  const land = await browser.newContext({ ...devices["iPhone 13 landscape"] });
  const lp = await land.newPage();
  await lp.goto(B + `#/games/${(await mk(s1)).public_id}`); await lp.waitForSelector(".transport .seek"); await wait(lp, 600);
  const lr = await lp.evaluate(() => { const ys = [".controls", ".seek-wrap", ".transport-time", ".queue-btn"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return (r.top + r.bottom) / 2; }); return { spread: Math.max(...ys) - Math.min(...ys), hint: getComputedStyle(document.querySelector(".swipe-hint")).display, bottom: document.querySelector(".transport").getBoundingClientRect().bottom, h: innerHeight }; });
  ok(lr.spread < 6 && lr.hint === "none" && lr.bottom <= lr.h + 0.5, `a phone on its side keeps the bar in one row, without the hint (${JSON.stringify(lr)})`);

  console.log("[lyric focus: Next question (default) and Current line]");
  const lw = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  lw.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const st = () => lw.evaluate(() => { const vp = document.querySelector(".lyric-window"), cur = vp.querySelector('.lw-line[data-follow="true"]'); const v = vp.getBoundingClientRect(), c = cur.getBoundingClientRect(); return { top: vp.scrollTop, idx: [...vp.querySelectorAll(".lw-line")].indexOf(cur), focused: cur.dataset.focus === "true", off: Math.round((c.top + c.height / 2) - (v.top + v.height / 2)), max: vp.scrollHeight - vp.clientHeight }; });
  await lw.goto(B + `#/games/${(await mk(s1)).public_id}`); await lw.waitForSelector(".lw-line"); await wait(lw, 800);
  let a = await st();
  ok(a.focused && a.idx === 0, "default: the window sits on the open question's line from the start");
  // sample the scroll position through an answer: it must go one way only (no overshoot and return)
  const sample = () => lw.evaluate(() => new Promise((res) => { const vp = document.querySelector(".lyric-window"), xs = []; const t0 = performance.now(); const f = () => { xs.push(Math.round(vp.scrollTop)); if (performance.now() - t0 < 600) requestAnimationFrame(f); else res(xs); }; f(); }));
  let moves = 0, wiggle = 0;
  for (let i = 0; i < 60; i++) {
    const p = sample(); await lw.keyboard.press("1"); const xs = await p;
    const d = xs.map((x, k) => (k ? x - xs[k - 1] : 0)).filter((x) => x !== 0);
    if (d.length) { moves++; if (d.some((x) => Math.sign(x) !== Math.sign(d[0]))) wiggle++; }
    await wait(lw, 100);
  }
  ok(moves >= 6, `answering moves the window to the next question (${moves} moves in 60 answers)`);
  ok(wiggle === 0, `every move goes one way only: no overshoot and return (${wiggle} moves wiggled)`);
  a = await st();
  ok(a.focused && (Math.abs(a.off) < 60 || a.top === a.max), `and the question's line is in the middle (${a.off} px off)`);
  const fonts = await lw.evaluate(() => [...new Set([...document.querySelectorAll(".lw-line")].map((l) => getComputedStyle(l).transitionProperty))]);
  ok(fonts.every((t) => !/font-size/.test(t)), "game text is never animated: no font-size transition on the lines (" + fonts.join(",") + ")");

  await lw.goto(B + "#/settings"); await lw.waitForSelector('[aria-label="Lyrics follow"]');
  const pressed = await lw.$$eval('[aria-label="Lyrics follow"] button', (b) => b.map((x) => x.textContent + ":" + x.getAttribute("aria-pressed")));
  ok(pressed.join() === "Next question:true,Current line:false", "Settings offers the two modes, Next question chosen: " + pressed.join(" "));
  await lw.click('[aria-label="Lyrics follow"] button:has-text("Current line")');
  await lw.goto(B + `#/games/${(await mk(s1)).public_id}`); await lw.waitForSelector(".lw-line"); await wait(lw, 800);
  await lw.keyboard.press("1"); await lw.keyboard.press("1"); await wait(lw, 900);
  a = await st();
  ok(a.idx === 0 && a.top === 0, "Current line: answering the song's own line leaves the window with the song");
  await browser.close();
})();
