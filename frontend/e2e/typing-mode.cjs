// Real-browser checks of the typing game mode: start panel, typing a round with full / partial / wrong answers and the
// ahead x1.5 bonus, Space and number keys, the phone layout, the lyric window colours, and the separate scoreboard.
// Stack as in new-features.cjs (own data dir, fake LRCLIB, song 1 with lyrics):
//   CHORUS_URL=http://localhost:18201/ DB_PATH=D/app.db node frontend/e2e/typing-mode.cjs
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const DB = process.env.DB_PATH;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wordOf = (qid) => execFileSync("sqlite3", [DB, `select missing_word from questions where id=${qid}`]).toString().trim();
const points = async (page) => Number(await page.textContent('[data-testid="points"]'));
const rgb = (page, css) => page.evaluate((c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, css);
const typo = (w) => w.slice(0, -1) + (w.endsWith("x") ? "y" : "x");

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  console.log("[start panel]");
  await page.goto(B); await page.waitForSelector(".song");
  await page.click(".song >> nth=0 >> .play-btn");
  ok(/30% of words/.test(await page.textContent(".start-panel")), "choose mode: medium is 30% of the words");
  await page.click('.mode-switch button:has-text("Type")');
  const labels = await page.$$eval(".start-panel .segmented:not(.mode-switch) button small", (e) => e.map((x) => x.textContent));
  ok(labels.join("|") === "10% of words|25% of words|40% of words|60% of words", "type mode: 10 / 25 / 40 / 60 % of the words: " + labels.join(", "));
  await page.click('.segmented:not(.mode-switch) button:has-text("Hard")');
  await page.click('button:has-text("Start new game")');
  await page.waitForSelector(".typing input");
  ok((await page.$$(".opt")).length === 0, "a typing game has a text field and no answer options");
  const dto = await page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()));
  ok(dto.mode === "typing" && dto.questions.length > 10, `${dto.questions.length} questions at the 40% level`);

  console.log("[typing a round]");
  const qs = dto.questions;
  const info = (i) => ({ id: qs[i].id, ahead: qs[i].audio_start > 0 });
  const ask = async (text) => { const f = page.locator(".typing input"); await f.fill(text); await f.press("Enter"); await page.waitForTimeout(250); };
  await page.keyboard.press("1");
  ok((await page.$(".typing input:disabled")) === null, "number keys do nothing in typing mode");
  await page.fill(".typing input", "a b");
  ok((await page.inputValue(".typing input")) === "a b" && !(await page.evaluate(() => window.__chorus)), "Space types a space in the field and does not start the song");
  await page.fill(".typing input", "");
  // question 0: full match (case ignored)
  const q0 = info(0), w0 = wordOf(q0.id);
  await ask(w0.toUpperCase());
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="points"]').textContent) > 0, null, { timeout: 4000 });
  const p0 = await points(page);
  ok(p0 === (q0.ahead ? 15 : 10), `a full match ${q0.ahead ? "ahead" : "(not ahead)"} earns ${q0.ahead ? 15 : 10} points: ${p0}`);
  // question 1: partial match (a typo)
  const q1 = info(1), w1 = wordOf(q1.id);
  await page.waitForSelector(".typing input:not(:disabled)");
  await ask(typo(w1));
  await page.waitForFunction((b) => Number(document.querySelector('[data-testid="points"]').textContent) > b, p0, { timeout: 4000 });
  const p1 = await points(page);
  ok(p1 - p0 === (q1.ahead ? 8 : 5), `a partial match earns ${q1.ahead ? "5 x 1.5 = 8" : "5"} points: +${p1 - p0}`);
  ok(await page.isVisible(".gain"), "the points pop up");
  // question 2: wrong
  const q2 = info(2), w2 = wordOf(q2.id);
  await page.waitForSelector(".typing input:not(:disabled)");
  await ask("qqqqqqqq");
  await page.waitForTimeout(400);
  ok((await points(page)) === p1, "a wrong answer earns nothing");
  const states = await page.$$eval(".lw-word", (e) => e.map((x) => ({ s: x.dataset.state, t: x.textContent })));
  const byState = (s) => states.find((x) => x.s === s);
  ok(byState("correct") && byState("correct").t.toLowerCase() === w0.toLowerCase(), "the lyric window shows the asked word green for the full match: " + JSON.stringify(byState("correct")));
  ok(byState("partial") && byState("partial").t.replace("~", "").toLowerCase() === w1.toLowerCase(), "…amber for the partial match, with the right word: " + JSON.stringify(byState("partial")));
  ok(byState("wrong") && byState("wrong").t.toLowerCase() === w2.toLowerCase(), "…and red for the wrong one, still showing the right word: " + JSON.stringify(byState("wrong")));
  const cols = { ok: await rgb(page, await page.$eval('.lw-word[data-state="correct"]', (e) => getComputedStyle(e).color)), bad: await rgb(page, await page.$eval('.lw-word[data-state="wrong"]', (e) => getComputedStyle(e).color)), mid: await rgb(page, await page.$eval('.lw-word[data-state="partial"]', (e) => getComputedStyle(e).color)) };
  ok(cols.ok[1] > cols.ok[0] && cols.bad[0] > cols.bad[1] && cols.mid[0] > cols.mid[2] && cols.mid[1] > cols.mid[2], `green ${cols.ok}, red ${cols.bad}, amber ${cols.mid}`);
  const state = await page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()));
  ok(state.progress.score === p1 && state.progress.streak === 0, "the server agrees: " + JSON.stringify(state.progress));

  console.log("[the rest of the game and the scoreboard]");
  for (let i = 3; i < qs.length; i++) {
    await page.waitForSelector(".typing input:not(:disabled)", { timeout: 5000 });
    await ask(wordOf(qs[i].id));
  }
  await page.waitForSelector(".notice.ok");
  ok(/Finished: \d+ points/.test(await page.textContent(".notice.ok")), "finished: " + (await page.textContent(".notice.ok")).slice(0, 90));
  await page.goto(B + "#/scores"); await page.waitForSelector(".tabs");
  ok(!(await page.$(".board li")), "the choice scoreboard does not show the typing game");
  await page.click('.tabs[aria-label="Game"] button:has-text("Type")'); await page.waitForSelector(".board li");
  ok((await page.textContent(".board li .who strong")) === "Guest" && Number(await page.textContent(".board li .pts")) > 0, "the typing scoreboard does");

  console.log("[phone]");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const g = await (await mctx.request.post(B + "api/games", { data: { song_id: 1, difficulty: "medium", mode: "typing" } })).json();
  const mp = await mctx.newPage();
  await mp.goto(B + "#/games/" + g.public_id); await mp.waitForSelector(".typing input");
  const fit = await mp.evaluate(() => { const t = document.querySelector(".typing").getBoundingClientRect(), b = document.querySelector(".transport").getBoundingClientRect(); return { fits: t.bottom <= b.top + 1 && b.bottom <= innerHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1, noPrompt: !document.querySelector(".prompt"), input: Math.round(t.height) }; });
  ok(fit.fits && fit.noPrompt, "phone: the field and Check sit above the player, nothing scrolls, no big sentence");
  await mp.fill(".typing input", wordOf(g.questions[0].id)); await mp.press(".typing input", "Enter");
  await mp.waitForTimeout(400);
  ok((await mp.$(".typing input:disabled")) !== null || (await mp.$$(".typing input")).length === 1, "phone: an answer is accepted");
  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL TYPING CHECKS PASSED");
})();
