// Beta 0.2.2: the Scores page (list of finished songs with place, search, board per song, sub-page on a phone, split on wide screens).
// Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/scores-page.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const SHOTS = process.env.SHOTS;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const syl = ["ba", "ke", "mi", "so", "tu", "la", "ne", "ri", "po", "du"];
const word = (n) => syl[n % 10] + syl[Math.floor(n / 10) % 10] + syl[Math.floor(n / 100) % 10] + "en";
const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 12 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${[0, 1, 2, 3].map((k) => word(i * 4 + k + stamp)).join(" ")} und noch ein Satz`).join("\n");
  const ctx0 = await browser.newContext();
  const boot = await ctx0.newPage();
  await boot.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } });
  const names = ["Paper Lanterns|Mara Vell", "Under the Bridge of Glass, Part Two (Live at the Old Harbour)|Okto", "Adiós|Rammstein"];
  const songs = [];
  for (let i = 0; i < names.length; i++) {
    const [t, a] = names[i].split("|");
    const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `${a} - ${t.replace(/[(),]/g, "")} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(30 + i, 11 + i * 3 + (stamp % 7)) } } })).json();
    await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
    await boot.request.patch(B + `api/songs/${s.id}`, { data: { title: t, artist: a } });
    songs.push({ ...s, title: t, artist: a });
  }
  const play = async (req, song, mode = "choice", right = true) => {
    const g = await (await req.post(B + "api/games", { data: { song_id: song.id, difficulty: "easy", mode } })).json();
    for (const q of g.questions) {
      const data = mode === "typing" ? { question_id: q.id, text: "x" } : { question_id: q.id, option_id: q.options[right ? 0 : q.options.length - 1].id };
      await req.post(B + `api/games/${g.public_id}/answers`, { data });
    }
    return g;
  };
  for (const s of songs) await play(boot.request, s);
  // other players
  const others = [];
  for (const n of ["lena", "kai", "mo", "yuki"]) {
    const c = await browser.newContext(); const r = c.request;
    await r.post(B + "api/auth/register", { data: { username: n, password: "another pass", display_name: n[0].toUpperCase() + n.slice(1) } });
    others.push(r);
    for (const s of songs.slice(0, n === "yuki" ? 3 : 1)) await play(r, s, "choice", n !== "mo");
  }
  const sess = await ctx0.storageState();

  for (const [label, opts, kind] of [["phone 390", { ...devices["iPhone 13"] }, "phone"], ["PC 1280", { viewport: { width: 1280, height: 800 } }, "wide"], ["phone landscape", { ...devices["iPhone 13 landscape"] }, "land"]]) {
    console.log(`[${label}]`);
    const ctx = await browser.newContext({ ...opts, storageState: sess, colorScheme: process.env.SCHEME ?? "dark" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await p.goto(B + "#/scores"); await p.waitForSelector(".scrow"); await wait(p, 500);
    ok((await p.locator(".scores-list select, .song-pick").count()) === 0, "no dropdown, no All songs / This song toggle");
    const rows = await p.$$eval(".scrow", (e) => e.map((r) => r.querySelector(".st")?.textContent));
    ok(rows[0] === "All songs" && rows.length === 4, "All songs first, then the 3 songs I finished: " + rows.join(" | "));
    const first = await p.$eval(".scrow:not(.all)", (r) => ({ title: r.querySelector(".st").textContent, mine: r.querySelector(".mine b").textContent, place: r.querySelector(".pb").textContent, of: r.querySelector(".place").textContent, label: r.getAttribute("aria-label") }));
    ok(/^\d[\d,]*pts$/.test(first.mine) && /^\d+$/.test(first.place) && /of \d+$/.test(first.of), `row shows my points and my place: ${first.mine} ${first.place} ${first.of}`);
    ok(/your best .* points, \d+(st|nd|rd|th) of \d+/.test(first.label), "aria-label: " + first.label);
    ok(first.title === "Adiós", "newest finished game first: " + first.title);
    await wait(p, 0);
    const dims = await p.evaluate(() => { const s = document.querySelector(".scores-search input").getBoundingClientRect(); return { h: s.height, sw: document.documentElement.scrollWidth, w: innerWidth }; });
    ok(dims.sw <= dims.w, "no horizontal overflow");
    ok(Math.abs(dims.h - (kind === "phone" ? 44 : kind === "land" ? 40 : 44)) <= 1, "search field height " + dims.h);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/scores-${kind}-list.png` });

    // search
    await p.fill(".scores-search input", "adios"); await wait(p, 200);
    ok((await p.locator(".scrow").count()) === 1 && (await p.locator(".scrow.all").count()) === 0, "search is accent-insensitive and hides the All songs row");
    await p.fill(".scores-search input", "zzzz"); await wait(p, 200);
    ok(/No played song matches/.test(await p.textContent(".scores-empty")), "no hits: the dashed card");
    await p.click(".scores-empty button"); await wait(p, 200);
    ok((await p.locator(".scrow").count()) === 4, "Clear search brings the list back");

    // open a song
    await p.click('.scrow:has-text("Paper Lanterns")'); await wait(p, 1200);
    if (kind === "phone") ok(/#\/scores\/\d+$/.test(await p.evaluate(() => location.hash)) && (await p.locator(".top-back").count()) === 1 && (await p.locator(".scrow").count()) === 0, "phone: the board is a sub-page with a back arrow before the logo");
    else ok((await p.locator(".scrow[aria-current=true]").count()) === 1 && (await p.locator(".board-pane").count()) === 1, kind + ": list and board side by side, the open row is marked");
    const board = await p.$$eval(".board > li:not(.gap)", (e) => e.map((r) => r.querySelector(".rank").textContent + ":" + r.querySelector("strong").textContent));
    ok(board.length === 5 && board[0].startsWith("1:"), "the top of the board: " + board.join(", "));
    ok((await p.textContent(".board-heading")).includes("All 5 players") && /You: [\d,]+ pts · \d(st|nd|rd|th) of 5/.test(await p.textContent(".you-line")), "heading and my line: " + (await p.textContent(".board-heading")));
    ok((await p.locator(".board li[data-me=true]").count()) === 1, "my row is marked");
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/scores-${kind}-board.png` });
    if (kind === "phone") { await p.click(".top-back"); await wait(p, 400); ok((await p.locator(".scrow").count()) === 4, "back returns to the list"); }

    // all songs
    await p.click(".scrow.all"); await wait(p, 1000);
    ok((await p.$$eval(".board > li:not(.gap) .who small", (e) => e.map((x) => x.textContent))).every((t) => /song/.test(t)), "All songs board lists totals per player (N songs)");

    // mode switch: nothing typed yet
    await p.goto(B + "#/scores"); await p.waitForSelector(".scrow");
    await p.click('.tabs button:has-text("Type")'); await wait(p, 900);
    ok((await p.locator(".scores-empty").count()) === 1 && (await p.locator(".scrow:not(.all)").count()) === 0, "Type mode: no finished games, the empty card");
    await p.click('.tabs button:has-text("Choose")');
    await ctx.close();
  }
  await browser.close();
})();
