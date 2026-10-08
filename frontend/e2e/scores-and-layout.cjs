// Real-browser checks of: evenly spread questions, the two scoreboards, and that the game screen fits every kind of screen.
// Same stack as new-features.cjs (own data dir, fake LRCLIB; song 1 = "Band - Testlied.wav" with lyrics id 1):
//   CHORUS_URL=http://localhost:18201/ DB_PATH=D/app.db node frontend/e2e/scores-and-layout.cjs
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const DB = process.env.DB_PATH;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const rightId = (qid) => Number(execFileSync("sqlite3", [DB, `select id from question_options where question_id=${qid} and is_correct=1`]).toString().trim());
const wrongId = (qid) => Number(execFileSync("sqlite3", [DB, `select id from question_options where question_id=${qid} and is_correct=0 limit 1`]).toString().trim());

/** Play a whole game through the API: the first `right` questions right, the rest wrong. */
async function finishGame(req, difficulty, right) {
  const g = await (await req.post(B + "api/games", { data: { song_id: 1, difficulty } })).json();
  for (const [i, q] of g.questions.entries()) {
    const option = i < right ? rightId(q.id) : wrongId(q.id);
    await req.post(B + `api/games/${g.public_id}/answers`, { data: { question_id: q.id, option_id: option, position: 0, waited: 0 } });
  }
  return g;
}

(async () => {
  const browser = await chromium.launch();

  console.log("[questions are spread over the whole song]");
  const probe = await browser.newContext();
  for (const difficulty of ["easy", "medium", "hard"]) {
    const g = await (await probe.request.post(B + "api/games", { data: { song_id: 1, difficulty } })).json();
    const ts = g.questions.map((q) => q.audio_start).sort((a, b) => a - b);
    const span = 55; // lyric lines at 0..55 s
    const thirds = [0, 1, 2].map((k) => ts.filter((t) => t >= (k * span) / 3 && t < ((k + 1) * span) / 3 + (k === 2 ? 1 : 0)).length);
    const lines = new Set(g.questions.map((q) => q.line_id)).size;
    ok(thirds.every((n) => n >= 0.2 * ts.length), `${difficulty}: ${ts.length} questions, per third of the song ${thirds.join(" / ")}`);
    if (difficulty === "easy") ok(lines === ts.length, "easy: at most one blank per line");
  }

  console.log("[scoreboards]");
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const anna = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const bob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await anna.request.post(B + "api/auth/register", { data: { username: "anna", password: "correct horse" } });
  await bob.request.post(B + "api/auth/register", { data: { username: "bob", password: "another pass" } });
  await finishGame(anna.request, "easy", 100);
  await finishGame(bob.request, "easy", 3);
  await finishGame(guest.request, "easy", 0);
  const ap = await anna.newPage();
  ap.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await ap.goto(B + "#/scores"); await ap.waitForSelector(".board li");
  let names = await ap.$$eval(".board li .who strong", (e) => e.map((x) => x.textContent));
  ok(names.join(",") === "anna,bob,Guest", "all songs: ranked by points: " + names.join(", "));
  ok((await ap.$$eval(".board li[data-me='true'] .who strong", (e) => e.map((x) => x.textContent))).join() === "anna", "the signed-in account's row is marked");
  await ap.click('.tabs button:has-text("This song")'); await ap.waitForSelector(".board li");
  const detail = await ap.textContent(".board li .who small");
  ok(/Easy · \d+ of \d+ · best x\d/.test(detail), "this song: shows difficulty, right answers and best multiplier: " + detail);
  await ap.goto(B); await ap.waitForSelector(".song"); await ap.click(".song >> nth=0 >> .play-btn");
  await ap.waitForSelector(".mini-board");
  ok(/Rank 1 of 3/.test(await ap.textContent(".history")), "the start panel says where you rank: " + (await ap.textContent(".history")).replace(/\s+/g, " ").slice(0, 120));
  const bp = await bob.newPage();
  await bp.goto(B + "#/scores"); await bp.waitForSelector(".board li");
  ok(await bp.isVisible(".board") && !(await bp.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "the scoreboard works on a phone without sideways scrolling");

  console.log("[the game screen fits every screen]");
  const g = await (await guest.request.post(B + "api/games", { data: { song_id: 1, difficulty: "medium" } })).json();
  const sizes = [[390, 844, "phone"], [412, 915, "phone"], [360, 640, "small phone"], [800, 1100, "tablet upright"], [1280, 680, "tablet on its side"], [1180, 820, "tablet on its side"], [1280, 900, "laptop"], [1920, 1080, "desktop"], [844, 390, "phone on its side"]];
  for (const scheme of ["light", "dark"]) for (const [w, h, name] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 1000, isMobile: w < 1000 });
    const pg = await ctx.newPage();
    await pg.goto(B + "#/games/" + g.public_id); await pg.waitForSelector(".opt").catch(() => {});
    const m = await pg.evaluate(() => { const bb = (s) => document.querySelector(s)?.getBoundingClientRect(); const o = bb(".options"), t = bb(".transport"); return o && t ? { fits: o.bottom <= t.top + 1 && t.bottom <= innerHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth, optionsTop: Math.round(o.top), barFlush: t.left === 0 && Math.round(t.width) === innerWidth && Math.round(t.bottom) === innerHeight, scoreBar: (() => { const c = document.querySelector('.countdown'); const p = document.querySelector('.score-panel').getBoundingClientRect(); return !c || c.hidden || (() => { const r = c.getBoundingClientRect(); return r.left >= p.left && r.right <= p.right && r.bottom <= p.bottom + 0.5; })(); })(), cols: getComputedStyle(document.querySelector(".options")).gridTemplateColumns.split(" ").length, layout: document.querySelector(".game").dataset.layout, prompt: !!document.querySelector(".prompt") } : null; });
    const wanted = w <= 700 || h <= 520 || (h > w && w <= 1100) ? "phone" : w <= 1300 || h <= 760 ? "compact" : "desktop";
    ok(m && m.fits, `${scheme} ${w}x${h} (${name}): answers and player bar fully on screen, nothing scrolls`);
    ok(m && m.barFlush, `${scheme} ${w}x${h}: the player bar spans the whole width and sits on the bottom edge (no frame around it)`);
    ok(m && m.layout === wanted && m.cols === 2 && m.prompt === (wanted !== "phone"), `${scheme} ${w}x${h}: ${wanted} layout, 2x2 answers, ${wanted === "phone" ? "no big sentence" : "sentence shown"}`);
    await ctx.close();
  }
  console.log("[browser bars sliding in and out]");
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await pc.newPage();
  await pp.goto(B + "#/games/" + g.public_id); await pp.waitForSelector(".opt");
  for (const h of [740, 844, 690]) {
    await pp.setViewportSize({ width: 390, height: h }); await pp.waitForTimeout(250);
    const r = await pp.evaluate(() => ({ bottom: Math.round(document.querySelector(".transport").getBoundingClientRect().bottom), vh: innerHeight, shellH: Math.round(document.querySelector(".shell").getBoundingClientRect().height), minH: getComputedStyle(document.querySelector(".shell")).minHeight, scrolls: document.documentElement.scrollHeight > innerHeight || document.body.scrollHeight > innerHeight }));
    ok(r.bottom === r.vh && r.shellH === r.vh && r.minH === "0px" && !r.scrolls, `viewport ${h} px high: the game screen follows the visible height (${r.shellH} = ${r.vh}), the player sits on the bottom edge, no min-height, no page scroll`);
  }
  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL SCORE AND LAYOUT CHECKS PASSED");
})();
