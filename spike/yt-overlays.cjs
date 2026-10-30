// Throwaway check: with the queue open, and with a score gain showing, nothing is drawn over the YouTube player.
const { chromium } = require("playwright");
const GAME = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  let bad = 0;
  for (const [w, h] of [[390, 844], [320, 568], [844, 390], [1280, 680], [820, 1180]]) {
    const phone = w < 900 && h < 1200;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:18205/#/games/${GAME}`);
    await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
    await p.waitForTimeout(1200);
    const covered = () => p.evaluate(() => {
      const f = document.querySelector(".yt-player iframe"), rc = f.getBoundingClientRect();
      let n = 0;
      for (let x = rc.x + 5; x < rc.right - 5; x += 10) for (let y = rc.y + 5; y < rc.bottom - 5; y += 10) if (document.elementsFromPoint(x, y)[0] !== f) n++;
      return n;
    });
    await p.click(".queue-btn");
    await p.waitForTimeout(700);
    const q = await covered();
    const scrim = await p.evaluate(() => { const s = document.querySelector(".sheet-scrim, .dialog-scrim"); return s ? JSON.stringify(s.getBoundingClientRect().toJSON()) : "no dialog"; });
    await p.screenshot({ path: `/tmp/yto-${w}x${h}-queue.png` });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
    const ok = q === 0;
    if (!ok) bad++;
    console.log(ok ? "ok " : "BAD", `${w}x${h} queue covered=${q} scrim=${scrim}`);
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
