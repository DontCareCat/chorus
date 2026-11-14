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
      const w = document.querySelector(".page-head").parentElement;
      const out = {};
      // replicas of the bar in its finished states (results at the right) and its running state (retry button at the right), at the bar's own tiers
      const variants = {
        "found": '<span class="lookup-groups"><span class="lookup-group">37</span><span class="lookup-group">1</span></span>',
        "not found": '<span class="lookup-groups"><span class="lookup-group">0</span><span class="lookup-group">12</span></span>',
        "partial": '<span class="lookup-groups"><span class="lookup-group">5</span><span class="lookup-group">3</span><span class="lookup-group">2</span></span>',
        "running with retry": '<span class="lookup-count">3/9</span><button type="button" class="lookup-retry"><svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor"/></svg></button>',
      };
      for (const [name, html] of Object.entries(variants)) {
        const clip = document.createElement("div"); clip.className = "lookup-clip"; clip.style.margin = "0";
        w.insertBefore(clip, document.querySelector(".page-head").nextSibling);
        const width = innerWidth < 340 ? "S" : innerWidth < 600 ? "M" : "L";
        clip.innerHTML = `<div class="lookup-bar" data-tier="${width === "L" ? "M" : width}" style="transform:none;opacity:1"><span class="lookup-icon" style="display:block"></span><span class="lookup-label">Lyrics</span>${html}</div>`;
        const bar = clip.firstElementChild.getBoundingClientRect(), icon = clip.querySelector(".lookup-icon").getBoundingClientRect();
        const last = clip.querySelector(".lookup-retry svg") ?? clip.querySelector(".lookup-group:last-child");
        out[name] = { left: icon.left - bar.left, right: bar.right - last.getBoundingClientRect().right };
        clip.remove();
      }
      out.sw = document.documentElement.scrollWidth; out.iw = innerWidth;
      return out;
    });
    for (const k of ["found", "not found", "partial", "running with retry"]) ok(Math.abs(r[k].right - r[k].left) <= 1, `${name}, ${k}: the right inset ${r[k].right}px matches the left ${r[k].left}px`);
    ok(r.sw <= r.iw, `${name}: no sideways scroll`);
    await ctx.close();
  }
  await browser.close();
})();
