// Real-browser checks of the album cover search: automatic save, choosing from candidates, own upload, removal.
// Stack: fake LRCLIB (:18202) and fake covers (:18203), backend with MUSICBRAINZ_BASE_URL / COVERART_BASE_URL pointing at it.
//   song 1 "Band - Testlied" (no embedded art here) -> one clear album; song 2 "Zweite Band - Anderes Lied" -> two albums.
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/covers.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGP4z8Dwn4EBABf6Af8rSOfFAAAAAElFTkSuQmCC", "base64");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const wav = (seed) => { const n = 8000 * 2, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 2000, 44 + i * 2); return d; };
  const upload = async (name, seed) => (await (await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(seed) } } })).json());
  const added = await upload("Band - Testlied (Remix).wav", 7); // no embedded art, one clear album
  await page.waitForTimeout(2500); // the lookup runs in the background after the upload
  let songs = await (await page.request.get(B + "api/songs")).json();
  const clear = songs.find((s) => s.id === added.id), unsure = songs.find((s) => s.title === "Anderes Lied"), embedded = songs.find((s) => s.title === "Testlied");

  console.log("[automatic lookup after the songs were added]");
  ok(clear.cover_source === "online" && clear.has_cover === true, "a clear match was saved by itself: " + clear.cover_source);
  ok(unsure.cover_source === "choose" && !unsure.has_cover, "an unclear match waits for a choice: " + unsure.cover_source);
  await page.goto(B); await page.waitForSelector(".song");
  const imgs = await page.$$eval(".song", (rows) => rows.map((r) => ({ t: r.querySelector(".song-title").textContent, w: r.querySelector(".cover img")?.naturalWidth ?? 0 })));
  ok(imgs.find((x) => x.t === "Testlied (Remix)").w === 32 && imgs.find((x) => x.t === "Anderes Lied").w === 0, "the library shows the found cover and a tile for the other song: " + JSON.stringify(imgs));
  ok(embedded.cover_source !== "online" && imgs.find((x) => x.t === "Testlied").w === 96, "a song with art inside its file keeps it and is never looked up");

  console.log("[choosing from candidates]");
  await page.goto(B + `#/songs/${unsure.id}`); await page.waitForSelector(".cover-picker");
  ok(/Choose the right one/.test(await page.textContent(".cover-picker")), "the song page says candidates were found");
  await page.click('.cover-picker button:has-text("Search online")');
  await page.waitForSelector(".cover-grid li");
  const cands = await page.$$eval(".cover-grid li", (e) => e.map((x) => x.querySelector("strong").textContent));
  ok(cands.join("|") === "Erstes Album|Zweites Album", "both albums are listed: " + cands.join(", "));
  await page.waitForFunction(() => [...document.querySelectorAll(".cover-grid img")].every((i) => i.naturalWidth === 32), null, { timeout: 5000 });
  ok(true, "their thumbnails load (through our server)");
  await page.click('.cover-grid li:nth-child(2) button');
  await page.waitForSelector(".notice.ok");
  await page.waitForFunction(() => document.querySelector(".page-head .cover img")?.naturalWidth === 32);
  ok(/Found online/.test(await page.textContent(".cover-picker")) && !(await page.$(".cover-grid")), "the chosen cover is saved and shown on the song page");
  const px = await page.evaluate(async (id) => { const b = await (await fetch(`/api/songs/${id}/cover`)).blob(); const bmp = await createImageBitmap(b); const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(bmp, 0, 0); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, unsure.id);
  ok(px[2] > px[0] && px[2] > px[1], "it is the second album's (blue) image: rgb(" + px + ")");

  console.log("[own image and removal]");
  await page.setInputFiles('.cover-picker input[type="file"]', { name: "mine.png", mimeType: "image/png", buffer: PNG });
  await page.waitForFunction(() => /your own image/i.test(document.querySelector(".cover-picker").textContent), null, { timeout: 5000 });
  ok(true, "an uploaded image replaces it (source: custom)");
  await page.setInputFiles('.cover-picker input[type="file"]', { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await page.waitForSelector(".cover-picker .notice.error");
  ok(/not a JPEG/.test(await page.textContent(".cover-picker .notice.error")), "something that is not an image is refused: " + (await page.textContent(".cover-picker .notice.error")).slice(0, 70));
  await page.click('.cover-picker button:has-text("Remove cover")');
  await page.waitForFunction(() => !document.querySelector(".page-head .cover img"), null, { timeout: 5000 });
  ok(true, "removing it brings back the plain tile");

  console.log("[settings]");
  await page.goto(B + "#/settings"); await page.waitForSelector("text=Save settings");
  ok(await page.isChecked('label:has-text("Look up missing album covers online") input'), "the lookup is on by default");
  ok(/sent to them/.test(await page.textContent('label:has-text("Look up missing album covers online")')), "and the setting says what is sent");
  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL COVER CHECKS PASSED");
})();
