// Beta 0.2.2: in the Dictionary review the recording button sits to the right of the asked word, centred on it (the card has_audio is faked
// in the reply, no deck needed). Isolated stack: backend :18201 and fake-dictionary.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/review-audio.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext();
  const bp = await boot.newPage();
  await bp.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } });
  for (const w of ["Haus", "Donaudampfschifffahrtsgesellschaftskapitän"]) await bp.request.post(B + "api/dictionary/entries", { data: { word: w, language: "de", meaning: "x" } });
  const st = await boot.storageState();
  for (const [name, opts] of [["phone", devices["iPhone 13"]], ["landscape", devices["iPhone 13 landscape"]], ["wide", { viewport: { width: 1280, height: 800 } }]]) for (const scheme of ["light", "dark"]) {
    console.log(`[${name}, ${scheme}]`);
    const ctx = await browser.newContext({ ...opts, storageState: st, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await p.route("**/api/dictionary/review/next*", async (r) => { const j = await (await r.fetch()).json(); if (j.card) j.card.has_audio = true; await r.fulfill({ json: j }); });
    await p.goto(B + "#/dictionary/review"); await p.waitForSelector(".review-start .btn, .review-card", { timeout: 15000 });
    if (await p.locator(".review-start .btn").count()) await p.click(".review-start .btn");
    for (let i = 0; i < 2; i++) {
      await p.waitForSelector(".review-card .word-audio"); await p.waitForTimeout(250);
      const m = await p.evaluate(() => {
        const w = document.querySelector(".review-word .rw-text"), b = document.querySelector(".review-word .word-audio");
        const wr = w.getBoundingClientRect(), br = b.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(w); const rects = [...range.getClientRects()];
        const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
        return { word: w.textContent, wLeft: wr.left, wRight: wr.right, wTop: top, wBottom: bottom, bLeft: br.left, bRight: br.right, bCy: br.top + br.height / 2, bw: br.width, bh: br.height, iw: innerWidth, sw: document.documentElement.scrollWidth, lines: rects.length };
      });
      ok(m.bLeft >= m.wRight - 1, `${m.word}: the button is to the right of the word (word ends ${Math.round(m.wRight)}, button starts ${Math.round(m.bLeft)})`);
      ok(m.bCy >= m.wTop && m.bCy <= m.wBottom, `and centred within the word's lines (centre ${Math.round(m.bCy)} in ${Math.round(m.wTop)}..${Math.round(m.wBottom)})`);
      ok(m.bw >= 44 && m.bh >= 44, `a 44 px touch target (${m.bw}x${m.bh})`);
      ok(m.bRight <= m.iw + 0.5 && m.sw <= m.iw, "inside the screen, no sideways scroll");
      if (i === 0) { await p.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/review-${name}-${scheme}.png` : "/dev/null" }).catch(() => undefined); await p.click(".rate button >> nth=0"); await p.waitForTimeout(500); if (await p.locator(".review-back").count() === 0) break; await p.click(".review-actions .btn"); }
    }
    await ctx.close();
  }
  await browser.close();
})();
