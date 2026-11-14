// A missing word's slot is as wide as the widest answer option and keeps its width (and the line its shape) when the blank is answered, right or wrong:
// no tick or cross beside the word, no sideways shift, no new wrap. Phone (390), PC (1280) and landscape; the lyric window and, on wide screens, the big sentence.
// Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/slot-stable.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE(Math.round(Math.sin(i / 20) * 6000), 44 + i * 2); return d; };
const pool = ["I", "am", "the", "night", "remember", "wonderful", "us", "sky", "beautiful", "love", "wide", "tomorrow", "go", "heart", "extraordinary", "run", "dreams", "fire", "ocean", "stay"];

// every box inside the line that carries the open blank (or the asked one), relative to the line's text, plus the line's own size
const focusIndex = (pg) => pg.evaluate(() => [...document.querySelectorAll(".lw-line")].findIndex((l) => l.querySelector('.lw-blank[data-focus="true"]')));
const sample = (pg, idx) => pg.evaluate((idx) => {
  const line = document.querySelectorAll(".lw-line")[idx];
  if (!line) return null;
  const text = line.querySelector(":scope > span");
  const o = text.getBoundingClientRect();
  const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round((r.left - o.left) * 10) / 10, Math.round((r.top - o.top) * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
  const prompt = document.querySelector(".prompt");
  const po = prompt?.getBoundingClientRect();
  return {
    lineH: Math.round(line.getBoundingClientRect().height * 10) / 10, textW: Math.round(o.width * 10) / 10,
    slots: [...text.querySelectorAll(".slot")].map(box), words: [...text.querySelectorAll(":scope > span:not(.slot)")].map(box),
    marks: line.querySelectorAll(".lw-mark, svg").length, label: line.textContent.replace(/\s+/g, " "),
    bigSlots: prompt ? [...prompt.querySelectorAll(".slot")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round((r.left - po.left) * 10) / 10, Math.round((r.top - po.top) * 10) / 10, Math.round(r.width * 10) / 10]; }) : [],
    bigH: po ? Math.round(po.height) : 0, scrollW: document.documentElement.scrollWidth, w: innerWidth,
  };
}, idx);
const same = (a, b, tol = 0.6) => a.length === b.length && a.every((x, i) => x.length === b[i].length && x.every((v, k) => Math.abs(v - b[i][k]) <= tol));

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false, queue_fade: false });
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${Array.from({ length: 7 }, (_, k) => pool[(i * 3 + k * 5) % pool.length]).join(" ")}`).join("\n");
  const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `SS - Slots ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(70) } } })).json();
  await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });

  for (const [label, opts] of [["phone 390", { ...devices["iPhone 13"] }], ["PC 1280", { viewport: { width: 1280, height: 800 } }], ["phone landscape", { ...devices["iPhone 13 landscape"] }]]) {
    console.log(`[${label}]`);
    const ctx = await browser.newContext(opts);
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    const g = await api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });
    await pg.goto(B + `#/games/${g.public_id}`); await pg.waitForSelector(".lyric-window .lw-blank"); await pg.waitForTimeout(600);
    // all lines the same size, so only the answer can change a line
    await pg.addStyleTag({ content: ".lw-line[data-d] { font-size: 17px !important; font-weight: 400 !important; letter-spacing: normal !important; padding: 5px 6px !important; } .lw-line, .lw-line time { transition: none !important; }" });
    const sizes = await pg.$$eval(".lw-blank", (e) => e.map((x) => Math.round(x.getBoundingClientRect().width)));
    const widest = await pg.$$eval(".lw-blank", (els) => els.slice(0, 6).map((e) => { const w = Math.max(...[...e.querySelectorAll(".slot-size")].map((x) => x.getBoundingClientRect().width)); return [Math.round(e.getBoundingClientRect().width), Math.round(w)]; }));
    ok(widest.every(([box, w]) => Math.abs(box - w) <= 1 || w < box), `an empty blank is as wide as its widest option (or the minimum): ${JSON.stringify(widest)}`);
    ok(new Set(sizes).size > 1, `blanks of different questions differ in width (${[...new Set(sizes)].join(", ")} px): not one fixed length`);

    const states = new Set();
    let n = 0;
    for (let i = 0; i < 10; i++) {
      const idx = await focusIndex(pg);
      if (idx < 0) break;
      const before = await sample(pg, idx);
      const opt = pg.locator(".opt:not(:disabled)").nth(i % 4);
      if (!(await opt.count())) break;
      await opt.click();
      await pg.waitForTimeout(250);
      const after = await sample(pg, idx);
      if (process.env.DBG && i < 2) console.log(JSON.stringify(before), "\n", JSON.stringify(after));
      const multi = before.slots.length > 1;
      const tag = `q${i + 1}${multi ? " (several gaps)" : ""}`;
      // the answered gap is the first slot that now holds a word
      const filled = await pg.evaluate((idx) => [...document.querySelectorAll(".lw-line")[idx].querySelectorAll(".lw-word")].map((e) => e.dataset.state), idx);
      filled.forEach((x) => states.add(x));
      ok(same(before.slots.map((x) => [x[0], x[2]]), after.slots.map((x) => [x[0], x[2]])), `${tag}: every slot keeps its x and width`);
      ok(same(before.slots.map((x) => [x[1], x[3]]), after.slots.map((x) => [x[1], x[3]])), `${tag}: every slot keeps its y and height (no new wrap)`);
      ok(same(before.words, after.words), `${tag}: the words around the gaps do not move`);
      ok(Math.abs(before.lineH - after.lineH) <= 0.6 && Math.abs(before.textW - after.textW) <= 0.6, `${tag}: the line keeps its size (${before.lineH} x ${before.textW})`);
      ok(after.marks === 0, `${tag}: no tick, cross or wave beside the word`);
      ok(/\((correct|wrong|almost right)\)/.test(after.label), `${tag}: the result is still in the text for screen readers`);
      ok(after.scrollW <= after.w, `${tag}: no sideways scroll`);
      n++;
    }
    ok(n >= 6, `${n} questions answered`);
    ok(states.has("correct") && states.has("wrong"), `both right and wrong answers were checked: ${[...states].join(", ")}`);
    if (!/390|landscape/.test(label)) {
      const big = await pg.evaluate(() => { const p = document.querySelector(".prompt"); return p ? [...p.querySelectorAll(".slot")].map((e) => { const w = Math.max(...[...e.querySelectorAll(".slot-size")].map((x) => x.getBoundingClientRect().width)); return [Math.round(e.getBoundingClientRect().width), Math.round(w)]; }) : null; });
      ok(big !== null && big.every(([box, w]) => box >= w - 1), `the big sentence's gaps hold their options too: ${JSON.stringify(big)}`);
    }
    await ctx.close();
  }
  await browser.close();
})();
