// The lyric window scrolls by hand and follows the song, or the next question while the player answers ahead of the song (guide section 23).
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/lyrics-scroll.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const syl = ["ba", "ke", "mi", "so", "tu", "la", "ne", "ri", "po", "du"];
const word = (n) => syl[n % 10] + syl[Math.floor(n / 10) % 10] + syl[Math.floor(n / 100) % 10] + "en";

const state = (p) => p.evaluate(() => {
  const vp = document.querySelector(".lyric-window"), cur = vp.querySelector('.lw-line[aria-current="true"]');
  const v = vp.getBoundingClientRect(), c = cur.getBoundingClientRect();
  return { top: vp.scrollTop, max: vp.scrollHeight - vp.clientHeight, idx: [...vp.querySelectorAll(".lw-line")].indexOf(cur), time: cur.querySelector("time")?.textContent, focused: cur.dataset.focus === "true", off: Math.round((c.top + c.height / 2) - (v.top + v.height / 2)), inView: c.bottom > v.top && c.top < v.bottom, chip: !!document.querySelector(".chip-float"), chipDir: document.querySelector(".chip-float")?.dataset.dir };
});
const settle = (p, ms = 900) => p.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, u, d) => (await page.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false });
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${[0, 1, 2, 3, 4].map((k) => word(i * 5 + k + stamp * 3)).join(" ")} und ein langer Satz`).join("\n");
  const s = await (await page.request.post(B + "api/songs", { multipart: { file: { name: `LS - Song ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(70, 3301 + stamp) } } })).json();
  await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const mk = () => api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });

  console.log("[PC: scrolling by hand]");
  let g = await mk();
  await page.goto(B + `#/games/${g.public_id}`); await page.waitForSelector(".lw-line"); await settle(page);
  let st = await state(page);
  ok(st.max > 200, `the lyrics are longer than the window and scroll (${st.max}px more)`);
  ok(st.idx === 0 && st.top === 0 && !st.chip, "it starts on the first line, no chip");
  const box = await page.locator(".lyric-window").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 900); await settle(page, 500);
  st = await state(page);
  ok(st.top > 400, `the wheel scrolls the lyrics (${st.top}px)`);
  ok(st.chip && st.chipDir === "up" && !st.inView, "the followed line is out of sight: a chip points back up");
  await page.waitForTimeout(1200); st = await state(page);
  ok(st.top > 400, "nothing pulls the reader back while they browse");
  await page.click(".chip-float"); await settle(page);
  st = await state(page);
  ok(st.top === 0 && !st.chip, "the chip takes them back to the followed line");

  console.log("[PC: answering ahead of the song]");
  const press = async (n) => { for (let i = 0; i < n; i++) { await page.keyboard.press("1"); await page.waitForTimeout(60); } };
  await press(5); await settle(page, 700); // the first line's blanks: the song is on that line, so the window stays with it
  st = await state(page);
  ok(st.idx === 0, "answering the song's own line does not move the window");
  await press(20); await settle(page);
  st = await state(page);
  ok(st.idx > 2 && st.focused, `answering ahead: the window moved on to the next question's line (line ${st.idx}), song still at the start`);
  ok(Math.abs(st.off) < 60 || st.top === st.max, `...and it is in the middle of the window (${st.off}px off)`);
  const before = st.idx;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -400); await settle(page, 400);
  await page.mouse.wheel(0, 700); await settle(page, 400);
  st = await state(page);
  ok(st.chip || !st.inView || st.top !== 0, "browsing away from it");
  await press(1); await settle(page);
  st = await state(page);
  ok(st.inView && !st.chip && st.idx >= before, "an answer takes the reader back to the question's line");

  console.log("[PC: the song catches up]");
  const all = g.questions.length;
  for (let i = 0; i < all + 5 && (await page.locator('.lw-line[data-status="open"]').count()) > 0; i++) { await page.keyboard.press("1"); await page.waitForTimeout(40); }
  await settle(page);
  await page.click('.transport button[aria-label="Play"]'); await page.waitForTimeout(6500);
  st = await state(page);
  ok(/^0:0[4-7]$/.test(st.time ?? ""), `everything answered, so the lyrics follow the song itself (line at ${st.time})`);
  await page.click('.transport button[aria-label="Pause"]');

  console.log("[phone: touch scrolling]");
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  g = await mk();
  await ph.goto(B + `#/games/${g.public_id}`); await ph.waitForSelector(".lw-line"); await settle(ph);
  const fit = await ph.evaluate(() => ({ fit: getComputedStyle(document.documentElement).getPropertyValue("--vv-fit"), h: innerHeight, shell: document.querySelector(".shell").getBoundingClientRect().height, bottom: document.querySelector(".transport").getBoundingClientRect().bottom }));
  ok(Math.abs(parseFloat(fit.fit) - fit.h) < 2 && fit.shell <= fit.h + 0.5 && fit.bottom <= fit.h + 0.5, "the game screen is measured against the visible area: " + JSON.stringify(fit));
  const cdp = await ctx.newCDPSession(ph);
  const pb = await ph.locator(".lyric-window").boundingBox();
  await cdp.send("Input.synthesizeScrollGesture", { x: pb.x + pb.width / 2, y: pb.y + pb.height * 0.8, yDistance: -500, gestureSourceType: "touch", speed: 1200 });
  await settle(ph, 500);
  st = await state(ph);
  ok(st.top > 150, `a swipe up scrolls the lyrics (${st.top}px)`);
  ok(st.chip, "and offers the way back to the followed line");
  await ph.click(".chip-float"); await settle(ph);
  st = await state(ph);
  ok(st.top === 0 && !st.chip, "tapping it goes back");
  await browser.close();
})();
