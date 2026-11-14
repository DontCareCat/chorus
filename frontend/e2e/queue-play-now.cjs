// Beta 0.2.2: a song picked in the queue list during a game starts at once. Isolated stack: backend :18201 and fake-lrclib.
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/queue-play-now.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const syl = ["ba", "ke", "mi", "so", "tu", "la", "ne", "ri", "po", "du"];
const word = (n) => syl[n % 10] + syl[Math.floor(n / 10) % 10] + syl[Math.floor(n / 100) % 10] + "en";
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 10 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${[0, 1, 2].map((k) => word(i * 3 + k + stamp)).join(" ")} und ein Satz`).join("\n");
  const boot = await browser.newPage();
  const songs = [];
  for (let i = 0; i < 3; i++) {
    const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `QP - Song ${i} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(30 + i, 5 + i + (stamp % 5)) } } })).json();
    await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
    songs.push(s);
  }
  const g = await (await boot.request.post(B + "api/games", { data: { song_id: songs[0].id, difficulty: "easy", mode: "choice" } })).json();
  for (const phone of [true, false]) {
    console.log(phone ? "[phone]" : "[PC]");
    const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((q) => { if (!sessionStorage.getItem("chorus_queue")) sessionStorage.setItem("chorus_queue", JSON.stringify(q)); },
      { items: songs.map((s) => ({ songId: s.id, difficulty: "easy", mode: "choice" })), cursor: 1, playing: g.public_id });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await p.goto(B + `#/games/${g.public_id}`); await p.waitForSelector(".transport .strip"); await p.waitForTimeout(800);
    await p.click(".transport .queue-btn"); await p.waitForSelector(".queue-list .queue-pick");
    const rows = await p.$$eval(".queue-list .queue-pick", (e) => e.map((x) => x.getAttribute("aria-label")));
    ok(rows.length === 2 && rows.every((r) => /^Play .* now$/.test(r)), "the waiting songs are pickable: " + rows.join(" | "));
    const before = await p.evaluate(() => location.hash);
    await p.click(".queue-list li:nth-child(2) .queue-pick");
    await p.waitForFunction((h) => location.hash !== h, before, { timeout: 8000 }).catch(() => undefined);
    const after = await p.evaluate(() => location.hash);
    ok(after !== before && /#\/games\//.test(after), "picking the last song starts its game at once");
    await p.waitForSelector(".transport .strip");
    const title = await p.textContent(".game-title h1");
    ok(title.includes(`Song 2`), "and it is the song that was picked: " + title.trim());
    const q = await p.evaluate(() => JSON.parse(sessionStorage.getItem("chorus_queue")));
    ok(q.items[q.cursor - 1].songId === songs[2].id && q.items[q.cursor].songId === songs[1].id, "the others keep their order behind it");
    await ctx.close();
  }
  await browser.close();
})();
