// Real-browser checks of the Duplicates filter in the library (same file name, same title and artist).
// Stack as in language.cjs (own data dir):  CHORUS_URL=http://localhost:18201/ node frontend/e2e/duplicates.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (seed, secs = 2) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed + seed * 7) % 3000, 44 + i * 2); return d; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  page.addInitScript(() => { new MutationObserver(() => document.querySelector(".confirm-actions .btn.danger")?.click()).observe(document, { subtree: true, childList: true }); }); // answers the app's own confirmation (Confirm.tsx) like the native dialog was accepted
  const add = async (name, seed, secs) => (await (await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(seed, secs) } } })).json());

  console.log("[no duplicates, no chip]");
  const a = await add("Edith - Sun.wav", 41), b = await add("Paco - Moon.wav", 42);
  await page.goto(B); await page.waitForSelector(".song");
  ok((await page.$$('.chips button:has-text("Duplicates")')).length === 0, "the Duplicates chip is hidden while there are none");

  console.log("[same file name, same title and artist]");
  await add("Edith - Sun (1).wav", 43); // a copy of the first by file name (and by tags)
  await page.reload(); await page.waitForSelector(".song");
  const chip = page.locator('.chips button:has-text("Duplicates")');
  ok(await chip.count() === 1 && /1/.test(await chip.textContent()), "chip counts the extra copy only (the original stays out): " + (await chip.textContent()));
  await chip.click();
  const rows = await page.$$eval(".song", (e) => e.map((x) => x.textContent));
  ok(rows.length === 1 && rows[0].includes("Sun") && rows[0].includes("(1)"), "only the newer copy is listed, not the original: " + rows.length);
  ok((await page.$$(".dup-tag")).length === 1 && /Copy of/.test(await page.textContent(".dup-tag")), "it says whose copy it is: " + (await page.textContent(".dup-tag")) + " (" + (await page.getAttribute(".dup-tag", "title")) + ")");
  ok(await chip.getAttribute("aria-pressed") === "true", "chip is pressed");

  console.log("[removing a copy ends the filter]");
  await page.click(".song >> nth=0 >> .kebab"); await page.click('.song-menu >> text="Remove from library"');
  await page.waitForFunction(() => document.querySelectorAll(".song").length === 2 && !document.querySelector(".dup-tag"));
  ok((await page.$$('.chips button:has-text("Duplicates")')).length === 0, "chip gone, list back to all songs");

  console.log("[very long names stay inside the row]");
  const long = "Extraordinarily".repeat(12) + " " + "Unbreakable_title_without_spaces_".repeat(5);
  const l = await add("Long - Name.wav", 44);
  await page.request.patch(B + `api/songs/${l.id}`, { data: { title: long.slice(0, 290), artist: "Artist".repeat(40) } });
  for (const [w, h] of [[1280, 900], [390, 844], [768, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await page.goto(B); await page.waitForSelector(".song");
    const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, rows: [...document.querySelectorAll(".song-main")].map((r) => r.scrollWidth - r.clientWidth), title: Math.max(...[...document.querySelectorAll(".song-title")].map((t) => t.getBoundingClientRect().height)) }));
    ok(m.rows.length >= 2 && m.page <= 0 && m.rows.every((x) => x <= 0) && m.title < 70, `${w}px: no horizontal overflow, title height ${Math.round(m.title)}px`);
    await page.screenshot({ path: `/tmp/long-${w}.png` });
  }
  await browser.close();
  console.log(process.exitCode ? "FAILED" : "ALL DUPLICATE CHECKS PASSED");
})();
