// Beta 0.2.2: the lyrics lookup bar's results keep a gutter to the bar's right edge (same as the left one), at every width; no sideways scroll.
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/lookup-gutter.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext(); const bp = await boot.newPage();
  await bp.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } });
  const st = await boot.storageState();
  for (const [name, opts] of [["small phone", { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }], ["phone", devices["iPhone 13"]], ["landscape", devices["iPhone 13 landscape"]], ["tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }], ["wide", { viewport: { width: 1280, height: 800 } }]]) {
    const ctx = await browser.newContext({ ...opts, storageState: st, colorScheme: "dark" });
    const p = await ctx.newPage();
    await p.goto(B); await p.waitForSelector(".page-head");
    // a replica of the bar with its results (the real one needs songs that are still being searched)
    const r = await p.evaluate(() => {
      const clip = document.createElement("div"); clip.className = "lookup-clip"; clip.style.margin = "0";
      const w = document.querySelector(".page-head").parentElement; w.insertBefore(clip, document.querySelector(".page-head").nextSibling);
      clip.innerHTML = '<div class="lookup-bar" style="transform:none;opacity:1"><span class="lookup-label">Lyrics found</span><span class="lookup-groups"><span class="lookup-group">37</span><span class="lookup-group">1</span></span></div>';
      const bar = clip.firstElementChild.getBoundingClientRect(), g = clip.querySelector(".lookup-group:last-child").getBoundingClientRect(), l = clip.querySelector(".lookup-label").getBoundingClientRect();
      return { left: l.left - bar.left, right: bar.right - g.right, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    ok(r.right >= 12 && r.right >= r.left - 1, `${name}: gutter right ${r.right}px, left ${r.left}px`);
    ok(r.sw <= r.iw, `${name}: no sideways scroll`);
    await ctx.close();
  }
  await browser.close();
})();
