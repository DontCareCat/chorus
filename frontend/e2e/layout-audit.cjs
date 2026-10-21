// Layout audit: no box with a visible background or border may have text (or a control) closer than 10 px to its left or
// right edge, and a segmented control / chip group must be as wide as its options. Runs on the main pages at phone and
// desktop width, with a dictionary row open and the phone menu open (design guide section 14).
// Stack as in dictionary.cjs (words from a game):  CHORUS_URL=http://localhost:18201/ node frontend/e2e/layout-audit.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * 37) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt"];
const lrc = LINES.map((t, i) => `[00:${String(i * 5).padStart(2, "0")}.00] ${t}`).join("\n");

// Runs inside the page. Returns the boxes whose content touches their edge.
const audit = () => {
  const MIN = 10;
  const visible = (cs) => cs.display !== "none" && cs.visibility !== "hidden";
  const filled = (cs) => { const c = cs.backgroundColor; return c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent"; };
  const bordered = (cs) => ["Left", "Right"].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none");
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!visible(cs) || !(filled(cs) || bordered(cs))) continue;
    if (el.matches("html, body, .shell, main, svg, svg *, input[type=range], option, mark, i, kbd, .bars, .dot, .cover, .cover *, img, textarea, input, select, progress, .lw-track *")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 24 || r.width > innerWidth - 2) continue; // tiny tags / full-page backgrounds
    if (cs.borderRadius === "0px" && !bordered(cs)) continue;
    if (parseFloat(cs.borderRadius) >= Math.min(r.height / 2, 100)) continue; // pills (chips, segmented controls, tags): their padding is part of the shape
    let left = Infinity, right = Infinity;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const p = n.parentElement, pcs = getComputedStyle(p);
      if (!visible(pcs)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const q of range.getClientRects()) { if (!q.width) continue; left = Math.min(left, q.left - r.left); right = Math.min(right, r.right - q.right); }
    }
    for (const c of el.querySelectorAll("button, a.btn, svg")) {
      if (el.matches(".segmented, .theme-switch")) break; // controls inside the box
      const cr = c.getBoundingClientRect(); if (!cr.width || !visible(getComputedStyle(c))) continue;
      left = Math.min(left, cr.left - r.left); right = Math.min(right, r.right - cr.right);
    }
    if (left === Infinity) continue;
    if (left < MIN || right < MIN) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent || "").trim().slice(0, 24)}" left ${left.toFixed(1)} right ${right.toFixed(1)}`);
  }
  // segmented controls and chip groups: as wide as their options (no empty stretch)
  const stretched = [];
  for (const el of document.querySelectorAll(".theme-switch")) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const kids = [...el.children].map((c) => c.getBoundingClientRect());
    const inner = Math.max(...kids.map((k) => k.right)) - Math.min(...kids.map((k) => k.left));
    if (r.width - inner > 14) stretched.push(`${el.className} is ${r.width.toFixed(0)}px for ${inner.toFixed(0)}px of options`);
    const parent = el.parentElement.getBoundingClientRect();
    if (el.closest(".menu-panel") && Math.abs((r.left + r.right) / 2 - (parent.left + parent.right) / 2) > 2) stretched.push("theme switch is not centred in the menu");
  }
  return { out, stretched };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, p, d) => (await page.request.fetch(B + "api/" + p, { method: m, ...(d ? { data: d } : {}) })).json();
  const song = await (await page.request.post(B + "api/songs", { multipart: { file: { name: "Band - Lied.wav", mimeType: "audio/wav", buffer: wav(25) } } })).json();
  await page.request.post(B + `api/songs/${song.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  await page.request.post(B + "api/songs", { multipart: { file: { name: "Other - Thing.wav", mimeType: "audio/wav", buffer: wav(5) } } });
  const g = await api("POST", "games", { song_id: song.id, difficulty: "expert", mode: "typing" });
  for (const q of g.questions) await api("POST", `games/${g.public_id}/answers`, { question_id: q.id, text: "zzz" });
  await page.waitForTimeout(800);
  await api("POST", "games", { song_id: song.id, difficulty: "easy" }).then(async (c) => { for (const q of c.questions) await api("POST", `games/${c.public_id}/answers`, { question_id: q.id, option_id: q.options[0].id }); });

  const pages = [
    ["library", "", ".song", async () => { await page.click(".play-btn >> nth=0").catch(() => {}); }],
    ["dictionary (row open)", "#/dictionary", ".word", async () => { await page.click(".word-main >> nth=0"); await page.waitForSelector(".example"); }],
    ["review start", "#/dictionary/review", ".review-start", async () => {}],
    ["scores", "#/scores", "h1", async () => {}],
    ["settings", "#/settings", "text=Save settings", async () => {}],
    ["song page", `#/songs/${song.id}`, ".lyric-line", async () => {}],
  ];
  for (const [w, h, label] of [[390, 844, "phone"], [820, 1100, "tablet"], [1280, 900, "desktop"]]) {
    await page.setViewportSize({ width: w, height: h });
    console.log(`[${label} ${w}px]`);
    for (const [name, hash, sel, prep] of pages) {
      await page.goto(B + hash); await page.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
      await prep(); await page.waitForTimeout(250);
      const r = await page.evaluate(audit);
      ok(r.out.length === 0 && r.stretched.length === 0, `${name}: ${r.out.length + r.stretched.length ? [...r.out, ...r.stretched].join(" | ") : "no box has content touching its edge"}`);
    }
    if (label === "phone") { // the menu panel with the theme switch
      await page.goto(B); await page.waitForSelector(".song"); await page.click(".menu-btn"); await page.waitForSelector(".menu-panel .theme-switch");
      const r = await page.evaluate(audit);
      ok(r.out.length === 0 && r.stretched.length === 0, `menu panel: ${r.out.length + r.stretched.length ? [...r.out, ...r.stretched].join(" | ") : "theme switch is as wide as its options and centred"}`);
      await page.screenshot({ path: "/tmp/audit-menu.png" });
      await page.goto(B + "#/dictionary"); await page.waitForSelector(".word"); await page.click(".word-main >> nth=0"); await page.waitForSelector(".example");
      await page.screenshot({ path: "/tmp/audit-dictionary.png" });
    }
  }
  // Headless Chromium cannot show a phone's address bar, where plain 100vh is taller than the visible page and makes
  // every page scroll even when it is empty. So: no style rule may still use vh (the browser keeps the last valid
  // declaration, so "100vh; 100dvh" reads back as dvh).
  await page.goto(B);
  const vh = await page.evaluate(() => [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).flatMap((r) => r.cssRules ? [...r.cssRules] : [r]).filter((r) => /[0-9]vh\b/.test(r.cssText)).map((r) => r.cssText.slice(0, 90)));
  ok(vh.length === 0, "no rule sizes anything with plain vh (use dvh, design guide section 14): " + (vh.join(" | ") || "none"));
  await browser.close();
  console.log(process.exitCode ? "FAILED" : "LAYOUT AUDIT PASSED");
})();
