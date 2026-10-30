// Throwaway check (YouTube layouts): the YouTube game at many screen shapes — player >= 200x200, nothing over it, nothing scrolls, answers above the player bar.
const { chromium } = require("playwright");
const [GAME, TYPING] = [process.argv[2], process.argv[3]];
const SIZES = [[320, 568], [360, 640], [390, 844], [640, 360], [844, 390], [820, 1180], [1180, 820], [1280, 680], [1440, 900], [1920, 1080]];
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  let bad = 0;
  for (const [w, h] of SIZES) {
    const phone = Math.min(w, h) < 600 || (w < 900 && h < 700);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await p.goto(`http://localhost:18205/#/games/${GAME}`);
    await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
      const f = document.querySelector(".yt-player iframe"), rc = f.getBoundingClientRect();
      let covered = 0;
      for (let x = rc.x + 5; x < rc.right - 5; x += 10) for (let y = rc.y + 5; y < rc.bottom - 5; y += 10) {
        const els = document.elementsFromPoint(x, y);
        if (els[0] !== f) covered++;
      }
      const opts = [...document.querySelectorAll(".opt, .typing")];
      const optBottom = Math.max(0, ...opts.map((o) => o.getBoundingClientRect().bottom));
      const tr = document.querySelector(".transport")?.getBoundingClientRect();
      const d = document.documentElement;
      return { w: Math.round(rc.width), h: Math.round(rc.height), covered, game: document.querySelector(".game")?.dataset.game, scroll: d.scrollHeight - innerHeight, scrollX: d.scrollWidth - innerWidth, optBottom: Math.round(optBottom), transportTop: tr ? Math.round(tr.top) : null, overflowAns: tr ? optBottom > tr.top + 1 : false };
    });
    const ok = r.w >= 200 && r.h >= 200 && r.covered === 0 && r.scroll <= 0 && r.scrollX <= 0 && !r.overflowAns;
    if (!ok) bad++;
    console.log(ok ? "ok " : "BAD", `${w}x${h}`, JSON.stringify(r));
    await p.screenshot({ path: `/tmp/ytl-${w}x${h}.png` });
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
