// Throwaway check: typing in a YouTube game with the keyboard open (the viewport shrunk to what is left).
const { chromium } = require("playwright");
const GAME = process.argv[2];
const CASES = [[390, 844, 553], [320, 568, 315], [360, 800, 480], [844, 390, 190]];
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  let bad = 0;
  for (const [w, h, vis] of CASES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:18205/#/games/${GAME}`);
    await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
    await p.waitForTimeout(1200);
    await p.focus(".typing textarea");
    await p.setViewportSize({ width: w, height: vis });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const f = document.querySelector(".yt-player iframe").getBoundingClientRect();
      const t = document.querySelector(".typing textarea")?.getBoundingClientRect();
      let covered = 0;
      const fr = document.querySelector(".yt-player iframe");
      for (let x = f.x + 5; x < f.right - 5; x += 10) for (let y = f.y + 5; y < f.bottom - 5; y += 10) if (document.elementsFromPoint(x, y)[0] !== fr) covered++;
      const g = document.querySelector(".game").dataset;
      return { player: [Math.round(f.width), Math.round(f.height)], field: t && [Math.round(t.width), Math.round(t.height), Math.round(t.bottom)], covered, kbmode: g.kbmode ?? null, kb: g.kb ?? null, game: g.game, innerH: innerHeight, hint: document.querySelector(".state-line")?.textContent };
    });
    const playerOk = r.player[0] >= 200 && r.player[1] >= 200;
    const fieldOk = r.field && r.field[1] >= 52 && r.field[0] >= 160 && r.field[2] <= r.innerH;
    const short = r.innerH < 216 && r.game === "two";
    const ok = r.covered === 0 && (short || (playerOk && fieldOk));
    if (!ok) bad++;
    console.log(ok ? "ok " : "BAD", `${w}x${h} visible ${vis}`, JSON.stringify(r));
    await p.screenshot({ path: `/tmp/ytk-${w}x${vis}.png` });
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
