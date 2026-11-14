// Beta 0.2.2: the Dictionary review with many examples: the examples scroll in their own box (fades only where content is cut off), Back and Next stay
// fixed near the bottom above the tab bar. The examples are added to the reply of the answer call (no deck or song needed).
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/review-layout.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const SHOTS = process.env.SHOTS;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const sentence = (i) => `Das ist der ${i}. lange Beispielsatz mit schwarz und noch einigen Wörtern, damit die Zeile auf einem schmalen Bildschirm umbrechen muss.`;
const fake = (n) => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, song_id: 1, song_title: "Angst", sentence: n > 5 ? sentence(i + 1) : "Der schwarze Mann", translation: n > 5 ? `This is the ${i + 1}th long example sentence with black and a few more words.` : "The man in black", audio_start: null, audio_end: null, playable: false }));
(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext();
  const bp = await boot.newPage();
  await bp.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } });
  await bp.request.post(B + "api/dictionary/entries", { data: { word: "schwarz", language: "de", translation: "black, reflecting little or no light; illegal" } });
  const st = await boot.storageState();
  for (const [name, opts] of [["phone", devices["iPhone 13"]], ["landscape", devices["iPhone 13 landscape"]], ["wide", { viewport: { width: 1280, height: 800 } }]]) for (const [label, n] of [["many", 18], ["few", 1]]) {
    console.log(`[${name}, ${label} examples]`);
    const ctx = await browser.newContext({ ...opts, storageState: st, colorScheme: "dark" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await p.route("**/api/dictionary/review/*/answer", async (r) => { const j = await (await r.fetch()).json(); j.examples = fake(n); await r.fulfill({ json: j }); });
    await p.goto(B + "#/dictionary/review"); await p.waitForSelector(".review-start .btn, .review-card", { timeout: 15000 });
    if (await p.locator(".review-start .btn").count()) await p.click(".review-start .btn");
    await p.waitForSelector(".rate-btn");
    const front = await p.evaluate(() => { const r = document.querySelector(".rate").getBoundingClientRect(); const nav = document.querySelector(".main-nav").getBoundingClientRect(); return { bottom: r.bottom, ih: innerHeight, navTop: nav.top, navLeft: nav.left, navW: nav.width, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    ok(front.bottom <= front.ih && front.sw <= front.iw, `the question's tiles are on screen (bottom ${Math.round(front.bottom)} of ${front.ih})`);
    await p.click(".rate-btn >> nth=2"); await p.waitForSelector(".review-back .examples"); await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const a = document.querySelector(".review-actions").getBoundingClientRect(), nav = document.querySelector(".main-nav").getBoundingClientRect(), ex = document.querySelector(".examples");
      const e = ex.getBoundingClientRect(), cs = getComputedStyle(ex);
      return { aTop: a.top, aBottom: a.bottom, aLeft: a.left, aRight: a.right, navTop: nav.top, navLeft: nav.left, navRight: nav.right, ih: innerHeight, iw: innerWidth, exBottom: e.bottom, exH: e.height, sh: ex.scrollHeight, ch: ex.clientHeight, cut: ex.dataset.cut, ft: cs.getPropertyValue("--fade-t").trim(), fb: cs.getPropertyValue("--fade-b").trim(), mask: cs.maskImage || cs.webkitMaskImage, sw: document.documentElement.scrollWidth, btns: [...document.querySelectorAll(".review-actions button")].map((b) => b.getBoundingClientRect().height) };
    });
    const tabs = m.navTop > m.ih * 0.5 && m.navLeft < 5; // a bottom bar (phone); a rail on the left otherwise
    ok(m.aTop >= 0 && m.aBottom <= m.ih && m.aRight <= m.iw + 0.5, `Back and Next are on screen (${Math.round(m.aTop)}..${Math.round(m.aBottom)} of ${m.ih})`);
    ok(m.btns.every((h) => h >= 44), "44 px touch targets: " + m.btns.join(", "));
    if (tabs) ok(m.navTop - m.aBottom >= 12 && m.navTop - m.aBottom <= 40, `above the tab bar with a comfortable gap (${Math.round(m.navTop - m.aBottom)} px)`);
    else ok(m.aLeft >= m.navRight - 1, "right of the rail, not under it");
    ok(m.exBottom <= m.aTop, `the examples end above the buttons (${Math.round(m.exBottom)} <= ${Math.round(m.aTop)})`);
    ok(m.sw <= m.iw, "no sideways scroll");
    if (n > 5) {
      ok(m.sh > m.ch + 2, `the examples scroll inside their box (${m.sh} in ${m.ch})`);
      ok(m.cut === "true" && m.ft === "0px" && parseFloat(m.fb) > 0, `at the top: fade at the bottom only (${m.ft}, ${m.fb})`);
      await p.evaluate(() => { const e = document.querySelector(".examples"); e.scrollTop = 40; });
      await p.waitForTimeout(150);
      const mid = await p.evaluate(() => { const c = getComputedStyle(document.querySelector(".examples")); return [c.getPropertyValue("--fade-t").trim(), c.getPropertyValue("--fade-b").trim()]; });
      ok(parseFloat(mid[0]) > 0 && parseFloat(mid[1]) > 0, `in the middle: fades on both sides (${mid.join(", ")})`);
      await p.evaluate(() => { const e = document.querySelector(".examples"); e.scrollTop = e.scrollHeight; });
      await p.waitForTimeout(150);
      const end = await p.evaluate(() => { const c = getComputedStyle(document.querySelector(".examples")); return [c.getPropertyValue("--fade-t").trim(), c.getPropertyValue("--fade-b").trim()]; });
      ok(parseFloat(end[0]) > 0 && end[1] === "0px", `at the end: fade at the top only (${end.join(", ")})`);
      await p.evaluate(() => { document.querySelector(".examples").scrollTop = 0; });
    } else {
      ok(m.cut === "false" && m.ft === "0px" && m.fb === "0px", `few examples: no fades (${m.ft}, ${m.fb})`);
    }
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/review-layout-${name}-${label}.png` });
    // Next is reachable and works
    await p.click(".review-actions .btn.inverse"); await p.waitForTimeout(600);
    ok((await p.locator(".review-back").count()) === 0, "Next leaves the card");
    await ctx.close();
  }
  await browser.close();
})();
