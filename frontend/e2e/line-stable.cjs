// Two lyric-line glitches: (1) an answered word must show its final word and colour on the first frame it appears (never the chosen word in the plain colour first);
// (2) the width of the words must not jump while a line's weight and size animate on focus / unfocus, in Latin and in Cyrillic (a fallback font whose widths change with the weight).
// Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/line-stable.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE(Math.round(Math.sin(i / 20) * 6000), 44 + i * 2); return d; };
const SETS = {
  latin: ["wonderful", "remember", "night", "I", "tomorrow", "beautiful", "heart", "wide", "extraordinary", "ocean", "stay", "fire"],
  cyrillic: ["чудовий", "пам'ятаю", "ніч", "я", "завтра", "прекрасне", "серце", "широкий", "надзвичайний", "океан", "лишись", "вогонь"],
};

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false, queue_fade: false });
  const stamp = Date.now() % 100000;

  for (const [script, pool] of Object.entries(SETS)) {
    const lrc = Array.from({ length: 24 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${Array.from({ length: 6 }, (_, k) => pool[(i * 5 + k * 7) % pool.length]).join(" ")}`).join("\n");
    const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `LS - ${script} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(60) } } })).json();
    await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });

    for (const [label, opts] of [["phone 390", { ...devices["iPhone 13"] }], ["PC 1280", { viewport: { width: 1280, height: 800 } }]]) {
      console.log(`[${script}, ${label}]`);
      const ctx = await browser.newContext(opts);
      const pg = await ctx.newPage();
      pg.on("pageerror", (e) => console.log("PAGEERROR", e.message));
      // the server answers slowly, so a not-yet-judged answer would stay on the screen for a while
      await pg.route("**/api/games/*/answers", async (route) => { await new Promise((r) => setTimeout(r, 300)); await route.continue(); });
      const g = await api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });
      await pg.goto(B + `#/games/${g.public_id}`); await pg.waitForSelector(".lyric-window .lw-blank"); await pg.waitForTimeout(800);

      // ---- (1) the first frame of an answer
      await pg.evaluate(() => {
        window.__frames = [];
        const rgb = (c) => c;
        const loop = () => {
          const ws = [...document.querySelectorAll(".lw-word")];
          window.__frames.push({ t: performance.now(), words: ws.map((e) => ({ key: [...document.querySelectorAll(".lw-line")].indexOf(e.closest(".lw-line")) + ":" + [...e.parentElement.children].indexOf(e), text: e.querySelector(".slot-fill").textContent.replace(/ \((correct|wrong|almost right)\)$/, ""), color: rgb(getComputedStyle(e).color), state: e.dataset.state })) });
          window.__raf = requestAnimationFrame(loop);
        };
        loop();
      });
      const colors = await pg.evaluate(() => { const c = (v) => { const e = document.createElement("span"); e.style.color = `var(${v})`; document.body.append(e); const x = getComputedStyle(e).color; e.remove(); return x; }; return { correct: c("--correct"), wrong: c("--wrong"), accent: c("--accent"), text: c("--text") }; });
      let answered = 0;
      for (let i = 0; i < 4; i++) {
        const opt = pg.locator(".opt:not(:disabled)").nth(i % 4);
        if (!(await opt.count())) break;
        await opt.click();
        await pg.waitForTimeout(700);
        answered++;
      }
      const frames = await pg.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames; });
      const seen = new Map(); // key -> first frame's {text,color}
      let bad = 0, flash = 0, changed = 0;
      for (const f of frames) for (const w of f.words) {
        if (!seen.has(w.key)) {
          seen.set(w.key, w);
          if (![colors.correct, colors.wrong, colors.accent].includes(w.color)) flash++;
        } else if (seen.get(w.key).text !== w.text || seen.get(w.key).color !== w.color) changed++;
      }
      ok(answered >= 3 && seen.size >= 3, `${answered} answers, ${seen.size} words seen over ${frames.length} frames`);
      ok(flash === 0, "every answered word is in its result colour on its very first frame (not the plain colour)");
      ok(changed === 0, "its text and colour never change after that first frame (no chosen word replaced by the right one)");

      // ---- (2) width jumps while a line changes focus
      const lines = await pg.$$(".lw-line[data-qid]");
      ok(lines.length > 6, `${lines.length} lines with blanks`);
      const widths = await pg.evaluate(async () => {
        const out = [];
        const buttons = [...document.querySelectorAll(".lw-line[data-qid]")];
        const sample = () => {
          const rows = [];
          for (const l of document.querySelectorAll(".lw-line")) {
            const fs = parseFloat(getComputedStyle(l).fontSize);
            const ws = [...l.querySelectorAll(".lw-tap")].filter((e) => !e.closest(".slot")).map((e) => Math.round((e.closest(".wlock") ?? e).getBoundingClientRect().width / fs * 1000) / 1000);
            rows.push({ fs, ws, w: getComputedStyle(l).fontWeight });
          }
          return rows;
        };
        const frames = [sample()];
        const run = (ms) => new Promise((res) => { const t0 = performance.now(); const f = () => { frames.push(sample()); performance.now() - t0 < ms ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
        for (const b of [buttons[buttons.length - 1], buttons[2], buttons[buttons.length - 3]]) { b.click(); await run(900); }
        return frames;
      });
      let maxJump = 0, weights = new Set();
      for (let i = 1; i < widths.length; i++) widths[i].forEach((row, li) => { weights.add(row.w); const prev = widths[i - 1][li]; if (prev && prev.ws.length === row.ws.length) row.ws.forEach((x, k) => { maxJump = Math.max(maxJump, Math.abs(x - prev.ws[k])); }); });
      ok(weights.size > 2, `the weight passes through ${[...weights].sort().join(", ")} (animated)`);
      ok(maxJump <= 0.06, `no word changes width (in em) by more than 0.06 between two frames: largest jump ${maxJump.toFixed(3)} over ${widths.length} frames`);
      await ctx.close();
    }
  }
  await browser.close();
})();
