// Sorting the library (guide section 17): the five keys, the direction button, the remembered choice, the value shown on each row.
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/library-sort.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt"];
const lrc = LINES.map((t, i) => `[00:${String(i * 5).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, p, d) => (await page.request.fetch(B + "api/" + p, { method: m, ...(d ? { data: d } : {}) })).json();
  const up = async (name, secs, seed) => (await (await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(secs, seed) } } })).json());
  const a = await up("Zed - Zebra.wav", 25, 3), b = await up("Amy - Apfel.wav", 25, 5), c = await up("Max - Mond.wav", 25, 7);
  for (const s of [a, b]) await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const play = async (s, right) => {
    const g = await api("POST", "games", { song_id: s.id, difficulty: "easy", mode: "typing" });
    for (const [i, q] of g.questions.entries()) await api("POST", `games/${g.public_id}/answers`, { question_id: q.id, text: i < right ? q.answer ?? "x" : "zzz" });
  };
  await play(a, 0); await play(b, 0); await play(b, 0); // a: 1 play, b: 2 plays, c: never
  const rows = async () => page.$$eval(".song .song-title", (e) => e.map((x) => x.textContent.trim()));
  const pick = async (text) => { await page.locator(".sort-control .select-btn").click(); await page.locator(".select-list [role=option]", { hasText: text }).first().click(); };

  await page.goto(B); await page.waitForSelector(".song");
  console.log("  order by name:", (await rows()).join(", "));
  ok(JSON.stringify(await rows()) === JSON.stringify(["Apfel", "Mond", "Zebra"]), "name A to Z is the default");
  await page.click(".sort-dir");
  ok(JSON.stringify(await rows()) === JSON.stringify(["Zebra", "Mond", "Apfel"]), "the direction button reverses it");
  ok((await page.getAttribute(".sort-dir", "data-reversed")) === "true", "the arrow turns over");
  await pick("Plays");
  ok(JSON.stringify(await rows()) === JSON.stringify(["Apfel", "Zebra", "Mond"]), "plays: most first, never played last: " + (await rows()).join());
  const meta = await page.$$eval(".song .sorted-by", (e) => e.map((x) => x.textContent.trim()));
  ok(meta.join("|") === "2 plays|1 play|never played", "each row says what it is sorted by: " + meta.join("|"));
  await pick("Recently played");
  ok((await rows())[0] === "Apfel" && (await rows())[2] === "Mond", "recently played: the latest first, unplayed last");
  await page.click(".sort-dir");
  ok((await rows())[2] === "Mond", "reversed, never-played songs still go last");
  await pick("Date added");
  ok(JSON.stringify(await rows()) === JSON.stringify(["Mond", "Apfel", "Zebra"]), "date added: newest first");
  await page.reload(); await page.waitForSelector(".song");
  ok(JSON.stringify(await rows()) === JSON.stringify(["Mond", "Apfel", "Zebra"]), "the choice is remembered after a reload");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  const box = await page.locator(".sort-control").boundingBox();
  ok(box && box.x >= 0 && box.x + box.width <= 390, "the sort control fits on a phone");
  await browser.close();
})();
