// In the game: the queue button, the next song starting by itself after a queued game, play again after the song ran out, the filled sliders.
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/game-queue.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt"];
const lrc = LINES.map((t, i) => `[00:${String(i * 4).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, u, d) => (await page.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  const stamp = Date.now() % 100000;
  const songs = [];
  for (const i of [0, 1]) {
    const s = await (await page.request.post(B + "api/songs", { multipart: { file: { name: `GQ - Song${i} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(20, 3001 + i * 101 + stamp * 13) } } })).json();
    await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
    songs.push(s);
  }
  const answerAll = async (g) => {
    for (const q of g.questions) {
      const a = q.question_text.split("____");
      const full = LINES.find((t) => t.startsWith(a[0]) && t.endsWith(a[1]));
      await api("POST", `games/${g.public_id}/answers`, { question_id: q.id, text: full.slice(a[0].length, full.length - a[1].length), position: q.audio_start + 1, waited: 0 });
    }
  };
  const g = await api("POST", "games", { song_id: songs[0].id, difficulty: "easy", mode: "typing" });
  await answerAll(g);
  const st = () => page.evaluate(() => { const a = document.querySelector("audio"); return { t: +a.currentTime.toFixed(2), ended: a.ended, paused: a.paused }; });

  console.log("[player]");
  await page.goto(B); await page.evaluate(([a, b]) => sessionStorage.setItem("chorus_queue", JSON.stringify({ items: [{ songId: a, difficulty: "progressive", mode: "choice" }, { songId: b, difficulty: "hard", mode: "typing" }], cursor: 1 })), [songs[0].id, songs[1].id]);
  await page.goto(B + `#/games/${g.public_id}`); await page.reload(); await page.waitForSelector(".transport");
  ok((await page.locator(".transport .queue-btn").count()) === 1, "the player has a queue button");
  ok((await page.locator(".queue-count").innerText()) === "1", "with the number of waiting songs");
  const fills = await page.$$eval(".seek, .volume-slider", (e) => e.map((x) => getComputedStyle(x).appearance === "none" && x.style.getPropertyValue("--p").endsWith("%")));
  ok(fills.length === 2 && fills.every(Boolean), "the progress and volume sliders are custom-drawn with a fill position");
  await page.click(".transport .queue-btn");
  await page.waitForSelector(".queue-row");
  ok((await page.locator(".queue-row").count()) === 1, "it opens the queue list");
  await page.keyboard.press("Escape");

  console.log("[play again after the song ran out]");
  await page.click('.transport button[aria-label="Play"]'); await page.waitForTimeout(800);
  await page.focus("input.seek"); await page.keyboard.press("End"); await page.keyboard.press("Tab");
  await page.waitForTimeout(1200);
  ok((await st()).ended, "the song ran out");
  await page.click(".transport button.big"); await page.waitForTimeout(1200);
  const s2 = await st();
  ok(!s2.ended && !s2.paused && s2.t < 4, `Play starts it again from the top (${s2.t} s)`);

  console.log("[the queue goes on by itself]");
  await page.click('.transport button[aria-label="Pause"]');
  await page.evaluate((id) => { const q = JSON.parse(sessionStorage.getItem("chorus_queue")); q.playing = id; sessionStorage.setItem("chorus_queue", JSON.stringify(q)); }, g.public_id);
  await page.reload(); await page.waitForSelector(".transport");
  await page.waitForSelector(".queue-next");
  ok(/Starting in/.test(await page.locator(".queue-next small").innerText()), "after the music stopped the next song counts down: " + (await page.locator(".queue-next strong").innerText()));
  await page.waitForFunction((id) => location.hash.startsWith("#/games/") && !location.hash.endsWith(id), g.public_id, { timeout: 12000 });
  const next = (await api("GET", "games"))[0];
  ok(next.song_id === songs[1].id && next.difficulty === "hard" && next.mode === "typing", `the next game uses the queue's song, level and mode: ${next.difficulty}/${next.mode}`);
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")).cursor)) === 2, "and the queue moved on");

  console.log("[Stay here cancels it]");
  const g2 = await api("POST", "games", { song_id: songs[0].id, difficulty: "easy", mode: "typing" }); await answerAll(g2);
  await page.evaluate(([id, a, b]) => sessionStorage.setItem("chorus_queue", JSON.stringify({ items: [{ songId: a, difficulty: "easy", mode: "choice" }, { songId: b, difficulty: "easy", mode: "choice" }], cursor: 1, playing: id })), [g2.public_id, songs[0].id, songs[1].id]);
  await page.goto(B + `#/games/${g2.public_id}`); await page.reload(); await page.waitForSelector(".queue-next");
  await page.click('.queue-next button[aria-label="Stay here"]');
  await page.waitForTimeout(6500);
  ok(page.url().endsWith(g2.public_id), "Stay here keeps the player on this game");
  await browser.close();
})();
