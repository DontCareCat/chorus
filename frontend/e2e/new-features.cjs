// Real-browser checks of: replacing saved lyrics, the score system (points, ahead bonus, multiplier, waiting decay),
// the sliding lyric window with per-word results, and accounts (guest, sign up, privacy of games, guest switch).
//
// Needs a stack with its own data dir and the fake LRCLIB (never run it against a library you care about):
//   python3 frontend/e2e/fake-lrclib.py 18202 &
//   LRCLIB_BASE_URL=http://127.0.0.1:18202/api uv run python -m app.launcher serve --port 18201 --data-dir D --frontend ../frontend/dist
//   song 1 "Band - Testlied.wav" (60 s) gets lyrics id 1 from the fake LRCLIB; song 2 any other song
//   CHORUS_URL=http://localhost:18201/ DB_PATH=D/app.db node frontend/e2e/new-features.cjs
// DB_PATH is only used to look up which option is the right one (the page never knows before an answer).
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const DB = process.env.DB_PATH;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };

const rightText = (qid) => execFileSync("sqlite3", [DB, `select text from question_options where question_id=${qid} and is_correct=1`]).toString().trim();
const dto = (page) => page.evaluate(() => fetch("/api/games/" + location.hash.split("/").pop()).then((r) => r.json()));
const pointsNow = async (page) => Number(await page.textContent('[data-testid="points"]'));
const level = async (page) => Number((await page.textContent('[data-testid="multiplier"]')).replace("x", ""));
/** Any CSS colour (Chrome reports oklch() as is) as [r, g, b], by letting a canvas resolve it. */
const toRgb = (page, css) => page.evaluate((c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, css);

async function newGame(page, difficulty = "hard") {
  const r = await page.request.post(B + "api/games", { data: { song_id: 1, difficulty } });
  const g = await r.json();
  await page.goto(B + "#/games/" + g.public_id);
  await page.waitForSelector(".prompt");
  return g;
}
/** Focus the question by clicking its lyric-window line (the window clips far lines: click through the DOM), then answer. */
async function answer(page, q, right = true) {
  await page.$eval(`.lw-line[data-qid="${q.id}"]`, (e) => { e.focus(); e.click(); });
  const options = await page.$$eval(".opt", (els) => els.map((e) => e.textContent.replace(/^\d/, "")));
  const wanted = rightText(q.id);
  const idx = right ? options.indexOf(wanted) : options.findIndex((o) => o !== wanted);
  const before = await pointsNow(page);
  await page.keyboard.press(String(idx + 1));
  return before;
}
const waitPoints = (page, from) => page.waitForFunction((f) => Number(document.querySelector('[data-testid="points"]').textContent) !== f, from, { timeout: 4000 });
const firstOfLine = (g, line) => g.questions.filter((q) => q.blank_index === 0).find((q) => q.audio_start === line * 5);

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await guest.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());

  console.log("[replace lyrics that are already saved]");
  await page.request.patch(B + "api/songs/1", { data: { lyrics_offset: 1.5 } });
  await page.goto(B + "#/songs/1"); await page.waitForSelector(".lyric-line");
  ok(/Ich gehe jeden Morgen/.test(await page.textContent(".lyric-line")), "the song starts with the first lyrics");
  ok(/Use different lyrics/.test(await page.textContent(".panel h2")), "the panel offers different lyrics");
  await page.click('button:has-text("Search again")');
  await page.waitForSelector(".candidates li");
  const cands = await page.$$eval(".candidates li", (els) => els.map((e) => ({ t: e.textContent, inUse: e.dataset.inUse, btn: !!e.querySelector("button") })));
  ok(cands.length === 2, "automatic search lists the candidates instead of silently re-attaching the same lyrics");
  ok(cands.filter((c) => c.inUse === "true").length === 1 && /In use/.test(cands.find((c) => c.inUse === "true").t) && !cands.find((c) => c.inUse === "true").btn, "the lyrics in use are marked and cannot be chosen again");
  ok(/Ich gehe jeden Morgen/.test(await page.textContent(".lyric-line")), "nothing was attached by the search itself");
  await page.click('.candidates li[data-in-use="false"] button');
  await page.waitForFunction(() => /Wir tanzen/.test(document.querySelector(".lyric-line")?.textContent ?? ""), null, { timeout: 5000 });
  ok(true, "choosing the other candidate replaces the lyrics");
  ok(/reset/.test(await page.textContent(".panel")), "the timing offset that belonged to the old lyrics is reset, and the page says so");
  ok((await page.textContent(".offset-value")).includes("0.0"), "offset shows 0.0 s");
  await page.click('button:has-text("Search again")'); await page.waitForSelector(".candidates li");
  await page.click('.candidates li[data-in-use="false"] button');
  await page.waitForFunction(() => /Ich gehe jeden Morgen/.test(document.querySelector(".lyric-line")?.textContent ?? ""), null, { timeout: 5000 });
  ok(true, "and back to the first lyrics (the live list is not stuck on one choice)");

  console.log("[score: +10, +15 ahead, multiplier every 4, reset on a wrong answer]");
  const g1 = await newGame(page);
  const lines = [1, 2, 3, 4, 5].map((k) => firstOfLine(g1, k));
  ok(lines.every(Boolean), "the hard game asks a question in each of lines 1 to 5");
  ok((await pointsNow(page)) === 0 && (await level(page)) === 1, "a new game starts at 0 points, x1");
  const expected = [25, 50, 75, 100];
  for (let i = 0; i < 4; i++) {
    const b = await answer(page, lines[i]); await waitPoints(page, b);
    ok((await pointsNow(page)) === expected[i], `answer ${i + 1} ahead of the music: ${expected[i]} points (10 + 15 ahead, x1)`);
  }
  ok((await level(page)) === 2, "after 4 right answers in a row the multiplier is x2");
  ok(await page.isVisible(".gain"), "the points of the last answer pop up");
  let b = await answer(page, lines[4]); await waitPoints(page, b);
  ok((await pointsNow(page)) === 150, "the fifth: (10 + 15) x 2 = 50 points -> 150");
  const wrongQ = firstOfLine(g1, 6);
  b = await answer(page, wrongQ, false);
  await page.waitForFunction(() => document.querySelector('[data-testid="multiplier"]').textContent === "x1", null, { timeout: 4000 });
  ok((await pointsNow(page)) === 150 && (await level(page)) === 1, "a wrong answer scores nothing and resets the multiplier to x1");
  const d1 = await dto(page);
  ok(d1.progress.score === 150 && d1.progress.streak === 0 && d1.progress.best_multiplier === 2, "the server agrees and remembers the best multiplier: " + JSON.stringify(d1.progress));

  console.log("[lyric window: sliding, sized by distance, per-word results]");
  const words = await page.$$eval(".lw-word", (els) => els.map((e) => ({ s: e.dataset.state, c: getComputedStyle(e).color, t: e.textContent })));
  const good = words.find((w) => w.s === "correct"), bad = words.find((w) => w.s === "wrong");
  const gc = await toRgb(page, good.c), bc = await toRgb(page, bad.c);
  ok(gc[1] > gc[0] && gc[1] > gc[2], "a right word is shown green: rgb(" + gc + ")");
  ok(bc[0] > bc[1] && bc[0] > bc[2], "a wrong word is shown red: rgb(" + bc + ")");
  ok(bad && bad.t === rightText(wrongQ.id), "…and the line shows the RIGHT word, not the one that was chosen: " + bad?.t);
  const wholeLineRed = await page.$$eval('.lw-line[data-status="wrong"]', (els) => els.every((e) => getComputedStyle(e).color !== getComputedStyle(e.querySelector(".lw-word[data-state=wrong]")).color));
  ok(wholeLineRed, "only the word is coloured, not the whole line");
  await page.click('button[aria-label="Play"]');
  await page.waitForFunction(() => window.__chorus?.controller?.state.name === "PLAYING");
  await page.waitForTimeout(800);
  const sizes = await page.$$eval(".lw-line", (els) => ({ d0: els.filter((e) => e.dataset.d === "0").map((e) => parseFloat(getComputedStyle(e).fontSize)), d1: els.filter((e) => e.dataset.d === "1").map((e) => parseFloat(getComputedStyle(e).fontSize)), d3: els.filter((e) => e.dataset.d === "3").map((e) => parseFloat(getComputedStyle(e).fontSize)) }));
  ok(sizes.d0.length === 1 && sizes.d0[0] > sizes.d1[0] && sizes.d1[0] > sizes.d3[0], `the current line is a little bigger, the others smaller: ${sizes.d0[0]} > ${sizes.d1[0]} > ${sizes.d3[0]} px`);
  const css = await page.evaluate(() => { const c = (sel) => getComputedStyle(document.querySelector(sel)).color; return { d0: c('.lw-line[data-d="0"]'), d1: c('.lw-line[data-d="1"]'), d3: c('.lw-line[data-d="3"]'), time: c('.lw-line[data-d="3"] time'), bg: getComputedStyle(document.body).backgroundColor }; });
  const lum = async (k) => { const [r, g, b] = await toRgb(page, css[k]); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = { d0: await lum("d0"), d1: await lum("d1"), d3: await lum("d3"), time: await lum("time"), bg: await lum("bg") };
  const dist = (v) => Math.abs(v - contrast.bg);
  ok(dist(contrast.d0) > dist(contrast.d1) && dist(contrast.d1) > dist(contrast.d3) && dist(contrast.time) < dist(contrast.d3), "contrast fades with distance; the timecode is the quietest of all");
  ok(/^\d+:\d\d$/.test(await page.textContent('.lw-line[data-d="0"] time')), "every line has its timecode on the left: " + (await page.textContent('.lw-line[data-d="0"] time')));
  const pos = async () => page.$eval('.lw-line[data-d="0"]', (e) => { const r = e.getBoundingClientRect(), v = document.querySelector(".lyric-window").getBoundingClientRect(); return { inside: r.top >= v.top - 1 && r.bottom <= v.bottom + 1, text: e.textContent }; });
  const p1 = await pos();
  await page.waitForTimeout(5200);
  const p2 = await pos();
  ok(p1.inside && p2.inside && p1.text !== p2.text, "the current line stays inside the window while the lyrics slide past");
  await page.screenshot({ path: "shots/lyric-window.png" });
  await page.click('button[aria-label="Stop"]');

  console.log("[score: waiting for an answer drains the multiplier]");
  const g2 = await newGame(page);
  const ahead = [1, 2, 3, 4].map((k) => firstOfLine(g2, k));
  for (const q of ahead) { const bb = await answer(page, q); await waitPoints(page, bb); }
  ok((await pointsNow(page)) === 100 && (await level(page)) === 2, "four ahead answers: 100 points, x2");
  await page.click('button[aria-label="Play"]');
  await page.waitForFunction(() => window.__chorus?.controller?.state.name === "PAUSED_FOR_QUESTION", null, { timeout: 20000 });
  ok(await page.isVisible('[data-testid="countdown"]'), "the audio waits for the first line's question: the countdown is running");
  const bar1 = await page.$eval('[data-testid="countdown"] i', (e) => e.style.transform);
  await page.waitForTimeout(1500);
  const bar2 = await page.$eval('[data-testid="countdown"] i', (e) => e.style.transform);
  ok(bar1 !== bar2, "the countdown bar drains: " + bar1 + " → " + bar2);
  await page.waitForFunction(() => document.querySelector('[data-testid="multiplier"]').textContent === "x1", null, { timeout: 8000 });
  ok(true, "after 5 s of waiting the multiplier dropped one level (x2 → x1)");
  ok(!(await page.isVisible('[data-testid="countdown"]')), "with nothing left to lose the countdown disappears");
  const q0 = g2.questions.find((q) => q.audio_start === 0 && q.blank_index === 0);
  const before = await pointsNow(page);
  await answer(page, q0); await waitPoints(page, before);
  ok((await pointsNow(page)) === 110, "the answer after the wait is worth 10 (x1, not ahead): " + (await pointsNow(page)));
  const d2 = await dto(page);
  ok(d2.progress.score === 110, "the server computed the same total from the waiting time it was told about: " + d2.progress.score);
  await page.click('button[aria-label="Stop"]');

  console.log("[accounts]");
  const anna = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await anna.newPage();
  ap.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await ap.goto(B + "#/login"); await ap.waitForSelector(".auth-card");
  ok(/Create an account/.test(await ap.textContent(".auth-card h1")) && /administer/.test(await ap.textContent(".auth-card")), "the first visit offers to create the first account, which administers the server");
  await ap.fill('input[autocomplete="username"]', "Anna");
  await ap.fill('input[autocomplete="new-password"]', "short");
  await ap.click('button:has-text("Create account")');
  await ap.waitForSelector(".notice.error");
  ok(/at least 8/.test(await ap.textContent(".notice.error")), "a weak password is explained: " + (await ap.textContent(".notice.error")));
  await ap.fill('input[autocomplete="new-password"]', "correct horse");
  await ap.click('button:has-text("Create account")');
  await ap.waitForFunction(() => document.querySelector(".account strong")?.textContent !== "Guest");
  ok((await ap.textContent(".account strong")) === "Anna" || /anna/i.test(await ap.textContent(".account strong")), "signed in as the new account: " + (await ap.textContent(".account")));
  const ag = await newGame(ap, "easy");
  ok(/points/i.test(await ap.textContent(".score-panel")), "Anna plays her own game");
  const ad = await dto(ap);
  const guestGames = await (await page.request.get(B + "api/games")).json();
  ok(guestGames.every((g) => g.public_id !== ag.public_id), "the guest does not see Anna's games");

  const bob = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const bp = await bob.newPage();
  await bp.goto(B + "#/login"); await bp.waitForSelector(".auth-card");
  await bp.click('.auth-card a:has-text("Create account")'); await bp.waitForSelector('input[autocomplete="new-password"]');
  await bp.fill('input[autocomplete="username"]', "bob");
  await bp.fill('input[autocomplete="new-password"]', "another pass");
  await bp.click('button:has-text("Create account")');
  await bp.waitForFunction(() => document.querySelector(".account strong")?.textContent !== "Guest");
  await bp.goto(B + "#/games/" + ag.public_id);
  await bp.waitForSelector(".notice.error, .prompt");
  ok(/does not exist/.test(await bp.textContent("main")), "Bob cannot open Anna's game by its link");
  ok(ad.questions.length > 0 && !(await bp.$(".prompt")), "…and gets no questions");
  await bp.goto(B + "#/settings"); await bp.waitForSelector("text=Save settings");
  ok(await bp.isDisabled('label:has-text("without signing in") input'), "Bob cannot change who may use the server (the administrator can)");

  await ap.goto(B + "#/settings"); await ap.waitForSelector("text=Save settings");
  ok(await ap.isEnabled('label:has-text("without signing in") input') && /Accounts on this server/.test(await ap.textContent("main")), "Anna, the administrator, can, and sees the accounts");
  await ap.uncheck('label:has-text("without signing in") input');
  await ap.click('button:has-text("Save settings")'); await ap.waitForSelector("text=Saved");
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await sp.goto(B); await sp.waitForSelector(".auth-card");
  ok(/#\/login/.test(sp.url()) && !(await sp.$(".songs")), "with guests switched off a stranger is taken to the sign-in page");
  ok(!(await sp.isVisible("text=Continue as guest")), "and is not offered guest access");
  await sp.fill('input[autocomplete="username"]', "anna");
  await sp.fill('input[autocomplete="current-password"]', "correct horse");
  await sp.click('button:has-text("Sign in") >> nth=-1');
  await sp.waitForSelector(".songs, .empty");
  ok(true, "signing in with the account works and opens the library");
  await sp.click('button:has-text("Sign out")');
  await sp.waitForSelector(".auth-card");
  ok(/#\/login/.test(sp.url()), "signing out returns to the sign-in page while guests are off");
  await ap.check('label:has-text("without signing in") input');
  await ap.click('button:has-text("Save settings")'); await ap.waitForSelector("text=Saved");

  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL NEW-FEATURE CHECKS PASSED");
})();
