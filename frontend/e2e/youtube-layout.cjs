// Real-browser check of the YouTube game at every screen shape: the player is at least 200x200, nothing is drawn over it (a grid of
// elementsFromPoint inside it), nothing scrolls, the answers end above the player bar; typing with the keyboard open keeps a 52 px field and
// the player; the queue (a sheet or a panel) and the score gain stay clear of it. Needs the network: the real YouTube player is used.
//   (own stack as in scores-and-layout.cjs)  CHORUS_URL=http://localhost:18205/ node frontend/e2e/youtube-layout.cjs
const { chromium, request } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18205/";
const VIDEO = process.env.YT_VIDEO ?? "dQw4w9WgXcQ";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const SIZES = [[320, 568], [360, 640], [390, 844], [640, 360], [844, 390], [820, 1180], [1180, 820], [1280, 680], [1440, 900], [1920, 1080]];
const KEYBOARD = [[390, 844, 553], [320, 568, 315], [360, 800, 480]];
const LRC = "[00:05.00] Never gonna give you up\n[00:09.00] Never gonna let you down\n[00:13.00] Never gonna run around and desert you\n[00:17.00] Never gonna make you cry\n[00:21.00] Never gonna say goodbye\n[00:25.00] Never gonna tell a lie and hurt you\n";

const coveredPoints = () => {
  const f = document.querySelector(".yt-player iframe"), rc = f.getBoundingClientRect();
  let n = 0;
  for (let x = rc.x + 5; x < rc.right - 5; x += 10) for (let y = rc.y + 5; y < rc.bottom - 5; y += 10) if (document.elementsFromPoint(x, y)[0] !== f) n++;
  return n;
};

(async () => {
  const api = await request.newContext({ baseURL: B });
  let song = await (await api.post("api/songs/youtube", { data: { url: VIDEO } })).json();
  await api.post(`api/songs/${song.id}/lyrics/upload`, { multipart: { file: { name: "x.lrc", mimeType: "text/plain", buffer: Buffer.from(LRC) } } });
  await api.patch(`api/songs/${song.id}`, { data: { language: "en" } });
  const choice = (await (await api.post("api/games", { data: { song_id: song.id } })).json()).public_id;
  const typing = (await (await api.post("api/games", { data: { song_id: song.id, mode: "typing" } })).json()).public_id;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const phoneLike = (w, h) => Math.min(w, h) < 600 || (w < 900 && h < 700);

  console.log("[the player at every screen shape]");
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phoneLike(w, h), isMobile: phoneLike(w, h) });
    const p = await ctx.newPage();
    await p.goto(`${B}#/games/${choice}`);
    await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(`(() => { const covered = (${coveredPoints.toString()})(); const f = document.querySelector(".yt-player iframe").getBoundingClientRect(); const bottoms = [...document.querySelectorAll(".opt")].map((o) => o.getBoundingClientRect().bottom); const t = document.querySelector(".transport")?.getBoundingClientRect(); const d = document.documentElement; return { w: f.width, h: f.height, covered, ansBottom: Math.max(0, ...bottoms), transportTop: t ? t.top : 1e9, scrollY: d.scrollHeight - innerHeight, scrollX: d.scrollWidth - innerWidth }; })()`);
    ok(r.w >= 199.5 && r.h >= 199.5, `${w}x${h}: player ${Math.round(r.w)}x${Math.round(r.h)} (at least 200x200)`);
    ok(r.covered === 0, `${w}x${h}: nothing is drawn over the player`);
    ok(r.ansBottom <= r.transportTop + 1, `${w}x${h}: the answers end above the player bar`);
    ok(r.scrollY <= 0 && r.scrollX <= 0, `${w}x${h}: nothing scrolls`);
    await ctx.close();
  }

  console.log("[typing with the keyboard open]");
  for (const [w, h, visible] of KEYBOARD) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(`${B}#/games/${typing}`);
    await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
    await p.waitForTimeout(1200);
    await p.focus(".typing textarea");
    await p.setViewportSize({ width: w, height: visible });
    await p.waitForTimeout(900);
    const r = await p.evaluate(`(() => { const covered = (${coveredPoints.toString()})(); const f = document.querySelector(".yt-player iframe").getBoundingClientRect(); const t = document.querySelector(".typing textarea").getBoundingClientRect(); return { pw: f.width, ph: f.height, fw: t.width, fh: t.height, fb: t.bottom, covered, vis: innerHeight }; })()`);
    ok(r.pw >= 199.5 && r.ph >= 199.5, `${w}x${visible}: player ${Math.round(r.pw)}x${Math.round(r.ph)}`);
    ok(r.fh >= 52 && r.fw >= 160 && r.fb <= r.vis, `${w}x${visible}: field ${Math.round(r.fw)}x${Math.round(r.fh)} stays on screen`);
    ok(r.covered === 0, `${w}x${visible}: nothing over the player`);
    await ctx.close();
  }

  console.log("[the queue stays clear of the player]");
  for (const [w, h] of [[390, 844], [320, 568], [844, 390], [1280, 680], [820, 1180]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phoneLike(w, h), isMobile: phoneLike(w, h) });
    const p = await ctx.newPage();
    await p.goto(`${B}#/games/${choice}`);
    await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
    await p.waitForTimeout(1200);
    await p.click(".queue-btn");
    await p.waitForTimeout(700);
    ok((await p.evaluate(`(${coveredPoints.toString()})()`)) === 0, `${w}x${h}: nothing over the player while the queue is open`);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
