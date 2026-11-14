// A Russian song on the web: language ru, choice and typing games with Cyrillic gaps and options, the lyric window shows the words, answers show the right word in its colour.
// Isolated stack: backend :18201 and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/russian-game.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); return d; };
const LINES = ["Я иду на работу каждое утро", "Ты спросил меня, а я ничего не сказал", "Мы едем на поезде на вокзал", "Солнце светит над городом", "Я очень люблю свою маленькую квартиру", "Луна высоко на небе сегодня", "Дети играют с маленькой собакой", "Мы пьём кофе рано утром"];
const cyr = /^[Ѐ-ӿ'’-]+$/;
(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  const lrc = LINES.map((t, i) => `[00:${String(i * 4).padStart(2, "0")}.00] ${t}`).join("\n");
  const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: "Группа - Русская песня.wav", mimeType: "audio/wav", buffer: wav(40) } } })).json();
  await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const choice = await api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });
  ok(choice.language === "ru" && choice.questions.length > 3, `a Russian choice game, ${choice.questions.length} questions`);
  ok(choice.questions.every((q) => q.options.length === 4 && q.options.every((o) => cyr.test(o.text))), "four Cyrillic options each");
  const typing = await api("POST", "games", { song_id: s.id, difficulty: "easy", mode: "typing" });
  ok(typing.language === "ru" && typing.questions.length > 3, "a Russian typing game");
  for (const [label, opts] of [["phone 390", { ...devices["iPhone 13"] }], ["PC 1280", { viewport: { width: 1280, height: 800 } }]]) {
    console.log(`[${label}]`);
    const pg = await (await browser.newContext(opts)).newPage();
    pg.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await pg.goto(B + `#/games/${choice.public_id}`); await pg.waitForSelector(".lyric-window .lw-blank"); await pg.waitForTimeout(600);
    ok(/[а-я]{3,}/i.test(await pg.textContent(".lyric-window")), "the lyric window shows Cyrillic words");
    await pg.locator(".opt:not(:disabled)").first().click();
    await pg.waitForSelector(".lw-word", { timeout: 4000 });
    const w = await pg.evaluate(() => { const e = document.querySelector(".lw-word"); return { text: (e.querySelector(".lw-tap") ?? e).textContent, state: e.dataset.state }; });
    ok(cyr.test(w.text) && ["correct", "wrong"].includes(w.state), `the answered word is the right Cyrillic word in its colour: ${JSON.stringify(w)}`);
    const tp = await (await browser.newContext(opts)).newPage();
    await tp.goto(B + `#/games/${typing.public_id}`); await tp.waitForSelector(".typing textarea");
    await tp.fill(".typing textarea", "йййййййй"); await tp.press(".typing textarea", "Enter");
    await tp.waitForSelector(".lw-word", { timeout: 4000 });
    const t = await tp.evaluate(() => { const e = document.querySelector(".lw-word"); return { text: (e.querySelector(".lw-tap") ?? e).textContent, state: e.dataset.state }; });
    ok(cyr.test(t.text) && t.state === "wrong", `a wrong typed answer shows the asked Cyrillic word in red: ${JSON.stringify(t)}`);
  }
  await browser.close();
})();
