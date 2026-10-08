// Real-browser check of the playback engine + synchronization (Web Audio fades, recovery, resume).
// Not part of `npm test`: needs a running stack and Playwright (`npm i playwright && npx playwright install chromium`).
//   1. backend on :8000 with song id 1 = 60 s 440 Hz tone + synced lyrics, 12 lines every 5 s (uploaded via the API)
//   2. `npx vite --port 5173` in frontend/   3. `node e2e/browser-check.cjs`
// It samples the REAL gain and AnalyserNode output level every 20 ms.
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:5173/";
const assert = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) process.exitCode = 1; };

/** Create a new game through the UI (Library → Play → difficulty → Start) and start the audio engine. */
async function open(browser) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  PAGEERROR", e.message));
  await page.goto(B);
  await page.waitForSelector(".song");
  await page.click('.song >> nth=0 >> .play-btn');
  await page.click('.segmented button:has-text("Easy")');
  await page.click('button:has-text("Start new game")');
  await page.waitForSelector(".prompt");
  return page;
}
async function startAudio(page) {
  await page.click('button[aria-label="Play"]');
  await page.waitForFunction(() => window.__chorus && window.__chorus.controller);
  await page.evaluate(() => {
    const a = document.querySelector("audio");
    window.__log = [];
    window.__t0 = performance.now();
    setInterval(() => {
      const { engine, controller } = window.__chorus;
      window.__log.push({ t: performance.now() - window.__t0, state: controller.state.name, blocking: controller.state.blockingId,
        gain: engine.getVolume(), level: engine.getOutputLevel(), time: a.currentTime, paused: a.paused });
    }, 20);
  });
}
const waitState = (page, name, timeout = 30000) =>
  page.waitForFunction((n) => window.__chorus.controller.state.name === n, name, { timeout, polling: 10 });
const log = (page) => page.evaluate(() => window.__log);
const mark = (page) => page.evaluate(() => window.__log.length);
const slice = async (page, from) => (await log(page)).slice(from);
const states = (l) => l.map((x) => x.state).filter((s, i, a) => i === 0 || s !== a[i - 1]);
/** Answer a question by its id: focus it via the lyric sheet, then press key 1. */
const answerQ = async (page, qid, key = "1") => { await page.$eval(`.lw-line[data-qid="${qid}"]`, (e) => { e.focus(); e.click(); }); await page.keyboard.press(key); };
/** The game as the API sees it (timings, answers) — the page's own URL carries the game id. */
const gameDto = (page) => page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()));
/** Answer every open question (a line can have several: each click focuses the line's first open question). */
async function answerAllOpen(page, limit = null) {
  let n = 0;
  for (;;) {
    const open = await page.$$('.lw-line[data-status="open"]');
    if (!open.length || (limit !== null && n >= limit)) return n;
    await open[0].evaluate((e) => { e.focus(); e.click(); }); // lines far from the playhead are clipped by the sliding window
    await page.keyboard.press("1");
    n++;
    await page.waitForTimeout(60);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

  console.log("\n[1] audio flows through the graph");
  let page = await open(browser);
  await startAudio(page);
  await page.waitForTimeout(1200);
  let l = await log(page);
  const last = l.at(-1);
  assert(last.state === "PLAYING" && !last.paused, `playing (state=${last.state})`);
  assert(last.time > 0.8, `position advances (t=${last.time.toFixed(2)}s)`);
  assert(Math.max(...l.map((x) => x.level)) > 0.2, `analyser sees the tone (peak rms ${Math.max(...l.map((x) => x.level)).toFixed(3)})`);

  console.log("\n[2] overrun → fade-out → pause → seek → wait → answer → fade-in");
  const m0 = await mark(page);
  await waitState(page, "FADING_OUT");
  await waitState(page, "PAUSED_FOR_QUESTION");
  await page.waitForTimeout(1500);
  l = await slice(page, m0);
  const fo = l.filter((x) => x.state === "FADING_OUT");
  const dur = fo.at(-1).t - fo[0].t;
  console.log(`  fade-out: ${fo.length} samples over ${dur.toFixed(0)} ms, gain ${fo[0].gain.toFixed(2)} → ${fo.at(-1).gain.toFixed(2)}`);
  assert(dur > 300 && dur < 700, "fade-out lasts ~400 ms");
  assert(fo.every((x, i) => i === 0 || x.gain <= fo[i - 1].gain + 1e-6) && fo[0].gain > 0.9, "gain falls monotonically from ~1 (smooth ramp, no abrupt cut)");
  assert(fo.filter((x) => x.gain > 0.1 && x.gain < 0.9).length >= 5, "intermediate gain values exist (a ramp, not a step)");
  assert(fo[0].level > 0.15 && fo.at(-1).level < 0.05, `output level follows: ${fo[0].level.toFixed(2)} → ${fo.at(-1).level.toFixed(3)}`);
  const paused = l.filter((x) => x.state === "PAUSED_FOR_QUESTION");
  assert(paused.every((x) => x.paused && x.gain === 0), "paused with gain 0 while waiting");
  assert(Math.max(...paused.map((x) => x.time)) - Math.min(...paused.map((x) => x.time)) < 0.05, "position does not move while waiting");
  assert(/Waiting for you/.test(await page.textContent(".state-line")), "the status line says the audio is waiting for you");
  const blockingId = paused[0].blocking;
  const m1 = await mark(page);
  await answerQ(page, blockingId);
  await waitState(page, "PLAYING");
  await page.waitForTimeout(500);
  l = await slice(page, m1);
  const fi = l.filter((x) => x.state === "FADING_IN");
  console.log(`  fade-in: ${fi.length} samples, gain ${fi[0].gain.toFixed(2)} → ${fi.at(-1).gain.toFixed(2)}`);
  assert(fi.every((x, i) => i === 0 || x.gain >= fi[i - 1].gain - 1e-6) && fi.at(-1).gain > 0.9, "gain rises monotonically back to ~1");
  assert(l.at(-1).state === "PLAYING" && l.at(-1).gain === 1 && l.at(-1).level > 0.2 && !l.at(-1).paused, "playing again at full gain, audible");
  const seq = states(await slice(page, m0)).filter((s) => s !== "SEEKING").join(">");
  assert(seq === "PLAYING>FADING_OUT>PAUSED_FOR_QUESTION>FADING_IN>PLAYING", "exact state sequence, one recovery only: " + seq);
  await page.close();

  console.log("\n[3] answer DURING the fade-out");
  page = await open(browser);
  await startAudio(page);
  await waitState(page, "FADING_OUT");
  await page.waitForFunction(() => window.__chorus.engine.getVolume() < 0.7, null, { polling: 5 });
  const bid = await page.evaluate(() => window.__chorus.controller.state.blockingId);
  const m3 = await mark(page);
  const tBefore = await page.evaluate(() => document.querySelector("audio").currentTime);
  await answerQ(page, bid);
  await waitState(page, "PLAYING");
  l = await slice(page, m3);
  const after = l.filter((x) => x.state === "FADING_IN");
  console.log(`  frozen at gain ${after[0].gain.toFixed(2)}, then ${after.at(-1).gain.toFixed(2)}`);
  assert(after[0].gain > 0.1 && after[0].gain < 0.7, "fade-in starts from the interrupted gain (no jump)");
  assert(!l.some((x) => x.state === "SEEKING") && l.every((x) => !x.paused), "no seek, audio never paused");
  assert(l.at(-1).time > tBefore, "playback simply continued");
  await page.close();

  console.log("\n[4] the next question appears INSTANTLY; the result is shown beside it");
  page = await open(browser);
  const first = await page.textContent(".prompt-count");
  const t0 = Date.now();
  await page.keyboard.press("1");
  await page.waitForFunction((f) => document.querySelector(".prompt-count").textContent !== f, first, { timeout: 2000, polling: 5 });
  const took = Date.now() - t0;
  assert(took < 200, `the next question is on screen ${took} ms after the answer`);
  assert(/Correct: |The word was |Answer recorded/.test(await page.textContent(".last-answer")), "the result of the answer is shown: " + (await page.textContent(".last-answer")));
  const word1 = await page.$eval('.lw-word', (e) => e.dataset.state);
  assert(["correct", "wrong", "pending"].includes(word1), "the lyric window records it too (" + word1 + ")");
  await page.close();

  console.log("\n[5] answering ahead: no interruption");
  page = await open(browser);
  await answerAllOpen(page);
  await startAudio(page);
  const m4 = await mark(page);
  await page.waitForTimeout(14000);
  l = await slice(page, m4);
  assert(l.every((x) => x.state === "PLAYING" || x.state === "IDLE"), "stayed PLAYING for 14 s with everything answered");
  assert(/answered|Enjoy/.test(await page.textContent(".state-line")), "status line: " + (await page.textContent(".state-line")));
  await page.close();

  console.log("\n[6] recovery position of a later question = start of the PREVIOUS lyric line");
  page = await open(browser);
  const g0 = await gameDto(page);
  await answerAllOpen(page, 3);                                   // the first three questions are answered
  const dto = await gameDto(page);
  const blocking = dto.questions.find((q) => !q.answer);          // earliest unanswered
  await startAudio(page);
  const m6 = await mark(page);
  await page.evaluate((t) => (document.querySelector("audio").currentTime = t), blocking.audio_end + 6);
  await waitState(page, "PAUSED_FOR_QUESTION", 20000);
  await page.waitForTimeout(300);
  l = await slice(page, m6);
  const p6 = l.filter((x) => x.state === "PAUSED_FOR_QUESTION");
  console.log(`  blocking question ${blocking.sequence + 1} (line ${blocking.audio_start}–${blocking.audio_end} s) → sought to ${p6[0].time.toFixed(2)} s, expected ${blocking.recovery_start}`);
  assert(g0.questions.length > 3 && p6[0].blocking === blocking.id, "the earliest UNANSWERED question blocks, not an answered one");
  assert(Math.abs(p6[0].time - blocking.recovery_start) < 0.15, "sought to the previous lyric line's start, not end-3");
  await page.close();

  console.log("\n[8] Stop: silence and back to the start, from any state");
  page = await open(browser);
  await startAudio(page);
  await page.waitForTimeout(2500);
  const st = () => page.evaluate(() => ({ st: window.__chorus.controller.state.name, t: document.querySelector("audio").currentTime, paused: document.querySelector("audio").paused, gain: window.__chorus.engine.getVolume() }));
  await page.click('button[aria-label="Stop"]');
  await page.waitForTimeout(400);
  let s8 = await st();
  assert(s8.st === "IDLE" && s8.t === 0 && s8.paused && s8.gain === 1, `while playing: stopped at 0:00 (state ${s8.st}, t=${s8.t})`);
  await page.click('button[aria-label="Play"]');
  await page.waitForTimeout(700);
  s8 = await st();
  assert(s8.st === "PLAYING" && s8.t > 0.3 && s8.t < 1.5 && !s8.paused, `play after stop starts from the beginning (t=${s8.t.toFixed(2)})`);
  await waitState(page, "PAUSED_FOR_QUESTION", 40000);
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Stop"]');
  await page.waitForTimeout(400);
  s8 = await st();
  assert(s8.st === "IDLE" && s8.t === 0 && s8.paused, "while waiting for an answer: stopped at 0:00 too");
  await page.close();

  console.log("\n[9] While a question is open: Play and Back 5 s work, the 3-second rule still holds");
  page = await open(browser);
  await answerAllOpen(page, 4);
  await startAudio(page);
  const dto9 = await gameDto(page);
  const b9 = dto9.questions.find((q) => !q.answer);
  await page.evaluate((t) => (document.querySelector("audio").currentTime = t), b9.audio_end + 6);
  await waitState(page, "PAUSED_FOR_QUESTION", 20000);
  await page.waitForTimeout(500);
  const wait9 = await st();
  console.log(`  waiting at ${wait9.t.toFixed(2)} s (previous line starts ${b9.recovery_start} s; the question's line is ${b9.audio_start}–${b9.audio_end} s)`);
  // Play without answering
  const m9 = await mark(page);
  await page.click('button[aria-label="Play"]');
  await page.waitForTimeout(800);
  let s9 = await st();
  assert(s9.st === "PLAYING" && !s9.paused && s9.gain === 1, "Play resumes the audio although the question is unanswered");
  await waitState(page, "PAUSED_FOR_QUESTION", 25000);
  await page.waitForTimeout(500);
  l = await slice(page, m9);
  const again = l.at(-1);
  assert(again.state === "PAUSED_FOR_QUESTION" && again.paused && again.gain === 0, "once the audio passes the deadline it fades out and waits again — the rule is not bypassed");
  assert(Math.abs(again.time - b9.recovery_start) < 0.2, `…back at the previous line's start (${again.time.toFixed(2)} s)`);
  assert(l.some((x) => x.state === "FADING_OUT"), "with the usual fade-out");
  // Back 5 seconds
  const m9b = await mark(page);
  await page.click('button[aria-label="Back 5 seconds"]');
  await page.waitForTimeout(600);
  s9 = await st();
  assert(s9.st === "PLAYING" && !s9.paused, "Back 5 seconds starts playing");
  l = await slice(page, m9b);
  const startedAt = l.find((x) => x.state === "PLAYING" && !x.paused).time;
  console.log(`  rewound from ${again.time.toFixed(2)} s: playing from ${startedAt.toFixed(2)} s`);
  assert(Math.abs(startedAt - (again.time - 5)) < 0.6, "it went back 5 seconds");
  await waitState(page, "PAUSED_FOR_QUESTION", 25000);
  assert(true, "and the game waits for the answer again afterwards");
  // answering resumes as before
  await page.click('button[aria-label="Back 5 seconds"]');
  await page.waitForTimeout(500);
  const m9c = await mark(page);
  await answerQ(page, b9.id);
  await page.waitForTimeout(700);
  l = await slice(page, m9c);
  assert(l.at(-1).state === "PLAYING" && !l.at(-1).paused, "answering while it plays just carries on");
  // pressing back repeatedly goes further back
  await page.close();

  console.log("\n[10] clicking the progress bars (timeline and slider) after the current question, again and again");
  page = await open(browser);
  await answerAllOpen(page, 3); // so the open question is a later one and there is something behind it to click back to
  await startAudio(page);
  await page.waitForTimeout(1200);
  const info = () => page.evaluate(() => { const a = document.querySelector("audio"); const ph = document.querySelector(".runway-playhead"); const g = window.__chorus; return { st: g.controller.state.name, t: a.currentTime, paused: a.paused, gain: g.engine.getVolume(), ph: parseFloat(ph.style.left), dur: a.duration }; });
  const dto10 = await gameDto(page);
  const open10 = dto10.questions.find((q) => !q.answer);
  const deadline10 = open10.audio_end + 3;
  const m10 = await mark(page);
  const rb = await page.locator(".runway").boundingBox();
  const sb = await page.locator("input.seek").boundingBox();
  let worst = 0;
  for (const frac of [0.5, 0.7, 0.9, 0.97, 0.5, 0.99, 0.8]) {
    await page.mouse.click(rb.x + rb.width * frac, rb.y + rb.height * 0.55);
    await page.waitForTimeout(90);
    await page.mouse.click(sb.x + sb.width * frac, sb.y + sb.height / 2);
    await page.waitForTimeout(90);
    worst = Math.max(worst, (await info()).t);
  }
  await page.waitForTimeout(600);
  l = await slice(page, m10);
  const i10 = await info();
  console.log(`  after 14 clicks: state ${i10.st}, audio ${i10.t.toFixed(2)} s (the open question's deadline is ${deadline10} s), highest position seen ${worst.toFixed(2)} s`);
  assert(!l.some((x) => x.state === "FADING_OUT" || x.state === "SEEKING" || x.state === "ERROR"), "no fade-out, rewind or error was triggered by the clicks");
  assert(worst <= deadline10 + 0.4, "the audio never ran past the open question's deadline");
  assert(Math.abs(i10.ph - (i10.t / i10.dur) * 100) < 1.5, `the playhead matches the audio position (${i10.ph.toFixed(1)}% vs ${(i10.t / i10.dur * 100).toFixed(1)}%)`);
  assert(/Answer the open question first/.test(await page.textContent(".last-answer")) || i10.t < deadline10, "the player is told why the click was limited: " + (await page.textContent(".last-answer")));
  assert(i10.st === "PLAYING" && !i10.paused && i10.gain === 1, "the game is still playing normally");
  // let it run into the deadline, then click on both bars WHILE it fades / waits
  await waitState(page, "FADING_OUT", 20000);
  const mfade = await mark(page);
  for (let i = 0; i < 4; i++) { await page.mouse.click(rb.x + rb.width * 0.9, rb.y + rb.height * 0.55); await page.mouse.click(sb.x + sb.width * 0.95, sb.y + sb.height / 2); await page.waitForTimeout(60); }
  await waitState(page, "PAUSED_FOR_QUESTION", 5000);
  await page.waitForTimeout(500);
  l = await slice(page, mfade);
  const w10 = await info();
  assert(w10.t >= open10.recovery_start - 0.2 && w10.t <= open10.recovery_start + 0.2, `clicks during the fade-out are ignored: it still rewinds to the previous line (${w10.t.toFixed(2)} s, expected ${open10.recovery_start} s)`);
  assert(l.at(-1).paused && l.at(-1).gain === 0, "and waits, silent");
  // clicks while waiting: far ahead is limited, backwards allowed; position stays near the question
  const ws = [];
  for (const frac of [0.95, 0.6, 0.99, 0.2, 0.9]) {
    await page.mouse.click(sb.x + sb.width * frac, sb.y + sb.height / 2);
    await page.waitForTimeout(250);
    ws.push((await info()).t);
  }
  console.log("  positions while waiting after clicks at 95/60/99/20/90 %: " + ws.map((v) => v.toFixed(1)).join(", ") + " s");
  assert(ws.every((v) => v <= deadline10 + 0.2), "while waiting, the position never goes past the open question's deadline");
  assert(ws[3] < ws[2], "clicking backwards moves back");
  assert((await info()).st === "PAUSED_FOR_QUESTION", "the game is still waiting for the answer");
  const ph2 = await info();
  assert(Math.abs(ph2.ph - (ph2.t / ph2.dur) * 100) < 1.5, "the playhead still matches the audio position");
  // the game is not broken: answering resumes it
  await answerQ(page, open10.id);
  await page.waitForTimeout(900);
  assert((await info()).st === "PLAYING", "answering resumes the game as usual");
  await page.close();

  console.log("\n[11] the answers stay at exactly the same place, whatever the question");
  for (const [label, vp] of [["desktop", { width: 1280, height: 860 }], ["phone", { width: 390, height: 844 }]]) {
    const p = await browser.newPage({ viewport: vp });
    await p.goto(B); await p.waitForSelector(".song");
    await p.click('.song:has-text("Testlied") >> .play-btn');
    await p.click('.segmented button:has-text("Expert")'); await p.click('button:has-text("Start new game")'); await p.waitForSelector(".prompt");
    const tops = new Set();
    const heights = new Set();
    const lines = await p.$$(".lw-line[data-qid]");
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      await lines[i].evaluate((e) => { e.focus(); e.click(); });
      await p.waitForTimeout(60);
      const m = await p.evaluate(() => ({ top: document.querySelector(".options").getBoundingClientRect().top + scrollY, h: document.querySelector(".prompt").getBoundingClientRect().height, fs: parseFloat(getComputedStyle(document.querySelector(".prompt")).fontSize), txt: document.querySelector(".prompt").textContent.length, fits: document.querySelector(".prompt").scrollHeight <= document.querySelector(".prompt").clientHeight + 1 }));
      tops.add(Math.round(m.top)); heights.add(Math.round(m.h));
      if (!m.fits) assert(false, `${label}: the sentence fits its box (${m.txt} chars at ${m.fs}px)`);
    }
    // answering (result line, filled blank) must not move it either
    // choosing a line far down the sheet brings its question into view
    await lines[lines.length - 1].click(); await p.waitForTimeout(900);
    const vis = await p.evaluate(() => { const r = document.querySelector(".prompt-wrap").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert(vis, `${label}: clicking a line at the bottom of the sheet scrolls its question into view`);
    await p.keyboard.press("1"); await p.waitForTimeout(150);
    tops.add(Math.round(await p.evaluate(() => document.querySelector(".options").getBoundingClientRect().top + scrollY)));
    console.log(`  ${label}: option block top positions seen: ${[...tops].join(", ")} px; question box heights: ${[...heights].join(", ")} px`);
    assert(tops.size === 1, `${label}: the answer block never moves across 12 different questions and after answering`);
    assert(heights.size === 1, `${label}: the question box keeps one height`);
    await p.close();
  }

  console.log("\n[14] the audio reaches its END with a question still unanswered (acceptance 8)");
  page = await open(browser);
  const dto14 = await gameDto(page);
  const last14 = dto14.questions.at(-1);
  for (const q of dto14.questions.slice(0, -1)) await answerQ(page, q.id);      // everything but the last question
  await startAudio(page);
  const m14 = await mark(page);
  await page.evaluate((t) => (document.querySelector("audio").currentTime = t), last14.audio_start); // just before it
  await page.waitForFunction(() => window.__chorus.controller.state.name === "PAUSED_FOR_QUESTION", null, { timeout: 30000 });
  await page.waitForTimeout(400);
  l = await slice(page, m14);
  const w14 = l.at(-1);
  console.log(`  song ends at ${await page.evaluate(() => document.querySelector("audio").duration)} s, last question ends ${last14.audio_end} s (+3 s grace would be after the end)`);
  assert(w14.state === "PAUSED_FOR_QUESTION" && w14.paused, "the audio ended with the question open: the game waits instead of just stopping");
  assert(Math.abs(w14.time - last14.recovery_start) < 0.2, `…at the previous line (${w14.time.toFixed(2)} s, expected ${last14.recovery_start} s)`);
  assert(!l.some((x) => x.state === "FADING_OUT"), "no fade-out: there was nothing playing to fade");
  assert(/Waiting for you/.test(await page.textContent(".state-line")), "the status line says it is waiting");
  await answerQ(page, last14.id);
  await page.waitForFunction(() => window.__chorus.controller.state.name === "IDLE", null, { timeout: 30000 });
  assert(true, "after the answer it plays on and ends cleanly (nothing left to answer)");
  await page.close();

  console.log("\n[12] volume control (desktop)");
  page = await open(browser);
  await page.evaluate(() => localStorage.removeItem("chorus.volume"));
  assert(await page.isVisible(".volume"), "the volume control is shown on a desktop-size screen with a mouse");
  await startAudio(page);
  await page.waitForTimeout(1200);
  const lvl = async () => { await page.waitForTimeout(350); return page.evaluate(() => ({ level: window.__chorus.engine.getOutputLevel(), master: window.__chorus.engine.getMasterVolume(), fade: window.__chorus.engine.getVolume(), slider: Number(document.querySelector(".volume-slider").value), label: document.querySelector(".volume .icon-btn").getAttribute("aria-label") })); };
  const setVol = (v) => page.evaluate((val) => { const el = document.querySelector(".volume-slider"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(val)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  let v12 = await lvl();
  console.log(`  full volume: output level ${v12.level.toFixed(3)}`);
  assert(v12.master === 1 && v12.slider === 1 && v12.level > 0.3, "starts at full volume, the tone is at full level");
  const full = v12.level;
  await setVol(0.5);
  v12 = await lvl();
  console.log(`  slider 50 %: output level ${v12.level.toFixed(3)} (${(v12.level / full * 100).toFixed(0)} % of full)`);
  assert(v12.master === 0.5 && Math.abs(v12.level / full - 0.5) < 0.08, "the slider really halves what is played");
  await page.click('.volume .icon-btn');
  v12 = await lvl();
  assert(v12.level < 0.01 && v12.label === "Unmute" && v12.slider === 0, `mute silences the audio (level ${v12.level.toFixed(4)}), the button says Unmute, the slider shows 0`);
  await page.click('.volume .icon-btn');
  v12 = await lvl();
  assert(Math.abs(v12.level / full - 0.5) < 0.08 && v12.slider === 0.5, "unmute brings back the remembered 50 %");
  await page.click("body", { position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowDown");
  v12 = await lvl();
  assert(Math.abs(v12.master - 0.45) < 1e-9 && Math.abs(v12.slider - 0.45) < 1e-9, "the ↓ key lowers it by 5 %");
  await page.keyboard.press("m");
  v12 = await lvl();
  assert(v12.level < 0.01 && v12.label === "Unmute", "the M key mutes");
  await page.keyboard.press("ArrowUp");
  v12 = await lvl();
  assert(v12.label === "Mute" && Math.abs(v12.master - 0.05) < 1e-9, "↑ while muted unmutes (starting from the bottom)");
  await setVol(0.45);
  const vb = await page.locator(".volume").boundingBox();
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.wheel(0, -100);
  v12 = await lvl();
  assert(Math.abs(v12.master - 0.5) < 1e-9, "the mouse wheel over the control changes it too (+5 %)");
  // fades still work at a lowered volume, and the volume setting survives them
  await waitState(page, "FADING_OUT", 40000);
  const mf = await mark(page);
  await waitState(page, "PAUSED_FOR_QUESTION", 5000);
  await page.waitForTimeout(400);
  l = await slice(page, mf);
  const fo12 = l.filter((x) => x.state === "FADING_OUT");
  assert(fo12.length > 8 && fo12.every((x, i) => i === 0 || x.gain <= fo12[i - 1].gain + 1e-6) && fo12.at(-1).gain < 0.05, "the fade-out still ramps 1 → 0 at a lowered volume");
  assert(fo12[0].level < full * 0.6, `…from the lowered level (${fo12[0].level.toFixed(2)}, not ${full.toFixed(2)})`);
  v12 = await lvl();
  assert(v12.master === 0.5, "the volume setting is untouched by the fade");
  const bid12 = await page.evaluate(() => window.__chorus.controller.state.blockingId);
  await answerQ(page, bid12);
  await waitState(page, "PLAYING", 4000);
  v12 = await lvl();
  console.log(`  after the fade-in: fade gain ${v12.fade}, output level ${v12.level.toFixed(3)}`);
  assert(v12.fade === 1 && Math.abs(v12.level / full - 0.5) < 0.1, "after the fade-in the audio is back at the player's 50 %, not at full volume");
  // remembered
  await page.reload();
  await page.waitForSelector(".prompt");
  const saved = await page.evaluate(() => ({ s: Number(document.querySelector(".volume-slider").value), raw: localStorage.getItem("chorus.volume") }));
  assert(saved.s === 0.5, "after a reload the slider still shows 50 % (" + saved.raw + ")");
  await page.click('button[aria-label="Play"]');
  await page.waitForFunction(() => window.__chorus && window.__chorus.engine);
  await page.waitForTimeout(900);
  const afterReload = await page.evaluate(() => ({ master: window.__chorus.engine.getMasterVolume(), level: window.__chorus.engine.getOutputLevel() }));
  assert(afterReload.master === 0.5 && Math.abs(afterReload.level / full - 0.5) < 0.1, "and is applied to the audio from the first second of the next game");
  await page.evaluate(() => localStorage.removeItem("chorus.volume"));
  await page.close();

  console.log("\n[13] no volume control on a phone-size screen");
  const ph = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ph.goto(B); await ph.waitForSelector(".song");
  await ph.click('.song:has-text("Testlied") >> .play-btn');
  await ph.click('.segmented button:has-text("Easy")'); await ph.click('button:has-text("Start new game")'); await ph.waitForSelector(".prompt");
  assert(!(await ph.isVisible(".volume")), "hidden: phones have hardware volume keys");
  assert(await ph.isVisible('button[aria-label="Play"]'), "the rest of the transport is unchanged");
  await ph.close();

  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL BROWSER CHECKS PASSED");
})();
