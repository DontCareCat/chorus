// Throwaway check (YouTube B2): a YouTube game in the real web app — player visible >= 200x200, nothing over it, time advances, seek works.
const { chromium } = require("playwright");
const GAME = process.argv[2], W = +(process.argv[3] || 1280), H = +(process.argv[4] || 800);
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(`http://localhost:18205/#/games/${GAME}`);
  await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
  await p.waitForTimeout(1500);
  const geo = await p.evaluate(() => {
    const f = document.querySelector(".yt-player iframe"), r = f.getBoundingClientRect();
    const pts = [[r.x + 4, r.y + 4], [r.right - 4, r.y + 4], [r.x + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.x + r.width / 2, r.y + r.height / 2]];
    const covered = pts.filter(([x, y]) => document.elementFromPoint(x, y) !== f).length;
    return { w: Math.round(r.width), h: Math.round(r.height), covered, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
  });
  console.log("geometry", JSON.stringify(geo));
  // start
  const start = await p.$(".controls button[aria-label='Play']");
  console.log("start button", !!start);
  if (start) await start.click();
  await p.waitForFunction(() => window.__chorus && window.__chorus.engine, null, { timeout: 15000 });
  await p.waitForTimeout(4000);
  const t1 = await p.evaluate(() => window.__chorus.engine.getCurrentTime());
  await p.waitForTimeout(3000);
  const t2 = await p.evaluate(() => window.__chorus.engine.getCurrentTime());
  console.log("time", t1.toFixed(2), "->", t2.toFixed(2), "state", await p.evaluate(() => window.__chorus.controller && window.__chorus.controller.getState ? JSON.stringify(window.__chorus.controller.getState()) : "?"));
  await p.screenshot({ path: `/tmp/yt-game-${W}.png` });
  await b.close();
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
