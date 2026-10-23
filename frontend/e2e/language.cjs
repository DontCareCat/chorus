// Real-browser checks of language detection for new songs and the language filter in the library.
// Stack as in new-features.cjs (own data dir; the fake LRCLIB may stay unused: lyrics are uploaded here).
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/language.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const pick = async (page, trigger, text) => { await page.locator(trigger).first().click(); await page.locator(".select-list [role=option]", { hasText: text }).first().click(); }; // our dropdown (components/Select.tsx)
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (seed) => { const n = 8000 * 2, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed + seed * 7) % 3000, 44 + i * 2); return d; };
const lrc = (lines) => lines.map((t, i) => `[00:${String(i * 3).padStart(2, "0")}.00] ${t}`).join("\n");
const TEXT = {
  fr: ["Je marche au travail chaque matin", "Tu m'as demandé et je n'ai rien dit", "Nous prenons le train pour aller à la gare", "Le soleil brille sur la ville"],
  es: ["Camino al trabajo cada mañana", "Me preguntaste y no dije nada", "Tomamos el tren hacia la estación", "El sol brilla sobre la ciudad"],
  en: ["I walk to work every morning", "You asked me and I said nothing at all", "We take the train to the station", "The sun is shining over the city"],
  vocal: ["La la la", "Ooh ooh ooh"],
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  const add = async (name, seed, lines) => {
    const s = await (await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(seed) } } })).json();
    if (lines) await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc(lines)) } } });
    return s;
  };
  const row = async (id) => (await (await page.request.get(B + "api/songs")).json()).find((s) => s.id === id);
  const langs = async () => (await page.$$eval(".song .lang", (e) => e.map((x) => x.textContent.trim().toLowerCase()))).sort();

  console.log("[new songs get the language of their lyrics]");
  const f1 = await add("Edith - Un jour.wav", 31, TEXT.fr), f2 = await add("Edith - Deux.wav", 32, TEXT.fr);
  const s1 = await add("Paco - Sol.wav", 33, TEXT.es), e1 = await add("Ann - Sun.wav", 34, TEXT.en), v1 = await add("Mute - Humm.wav", 35, TEXT.vocal);
  const none = await add("Nolyrics - Hmm.wav", 36, null);
  for (const [s, code] of [[f1, "fr"], [f2, "fr"], [s1, "es"], [e1, "en"]]) {
    const r = await row(s.id);
    ok(r.language === code && r.language_source === "detected", `${s.title}: ${r.language} (${r.language_source})`);
  }
  ok((await row(v1.id)).language_source === "default", "lyrics that are only 'la la la' leave the default language alone");
  ok((await row(none.id)).language_source === "default", "a song without lyrics keeps the default language");

  console.log("[the language filter]");
  await page.goto(B); await page.waitForSelector(".song");
  const chips = await page.$$eval(".lang-chips .chip", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(chips[0] === "All languages" && chips[1].startsWith("German") && chips[1].endsWith("4") && chips[2].startsWith("French") && chips[2].endsWith("2"), "chips list the languages in the library with their counts, biggest first: " + chips.join(" | "));
  ok(chips.some((c) => c.startsWith("German")) && chips.some((c) => c.startsWith("Spanish")) && chips.some((c) => c.startsWith("English")), "German (the default of the two songs without detection), Spanish and English are there too");
  const total = (await page.$$(".song")).length;
  await page.click('.lang-chips .chip:has-text("French")');
  ok(JSON.stringify(await langs()) === '["fr","fr"]', "French shows only the two French songs: " + (await langs()).join(","));
  await page.click('.chips:not(.lang-chips) .chip:has-text("Needs lyrics")');
  ok((await page.$$(".song")).length === 0 && /No songs match/.test(await page.textContent("main")), "it combines with the status filter");
  await page.click('.chips:not(.lang-chips) .chip:has-text("All")');
  await page.fill(".search-box input", "deux");
  ok((await page.$$(".song")).length === 1, "and with the search");
  await page.fill(".search-box input", "");
  await page.click('.lang-chips .chip:has-text("All languages")');
  ok((await page.$$(".song")).length === total, "All languages shows everything again");

  console.log("[the filter follows the library]");
  await page.click('.lang-chips .chip:has-text("Spanish")');
  ok((await page.$$(".song")).length === 1, "Spanish: one song");
  await page.request.patch(B + `api/songs/${s1.id}`, { data: { language: "en" } }); // the only Spanish song becomes English
  await page.reload(); await page.waitForSelector(".song");
  ok(!(await page.$$eval(".lang-chips .chip", (e) => e.some((x) => x.textContent.includes("Spanish")))), "a language nobody has any more disappears from the chips");
  ok((await page.$$(".song")).length === total, "…and the list shows all songs, not an empty page");

  console.log("[song page: detect on request, choices are respected]");
  await page.goto(B + `#/songs/${f1.id}`); await page.waitForSelector(".panel");
  ok(/Detected from the lyrics/.test(await page.textContent(".panel:has(h2:has-text('Song details'))")), "the song page says where the language came from");
  await pick(page, '.panel:has(h2:has-text("Song details")) .select-btn', "Spanish (es)");
  await page.click('button:has-text("Save details")'); await page.waitForSelector("text=Saved");
  await page.reload(); await page.waitForSelector(".panel");
  ok(/Chosen by you/.test(await page.textContent(".panel:has(h2:has-text('Song details'))")), "after saving a language it says 'Chosen by you'");
  await page.click('button:has-text("Detect from the lyrics")');
  await page.waitForFunction(() => /Language set to French/.test(document.body.textContent), null, { timeout: 5000 });
  ok((await row(f1.id)).language === "fr" && /Detected from the lyrics/.test(await page.textContent(".panel:has(h2:has-text('Song details'))")), "Detect from the lyrics sets French again");
  await page.goto(B + `#/songs/${v1.id}`); await page.waitForSelector(".panel");
  await page.click('button:has-text("Detect from the lyrics")');
  await page.waitForSelector(".panel .notice.error");
  ok(/too short or not clearly/.test(await page.textContent(".panel .notice.error")), "unclear lyrics are explained: " + (await page.textContent(".panel .notice.error")).slice(0, 70));
  await page.goto(B + `#/songs/${none.id}`); await page.waitForSelector(".panel");
  await page.click('button:has-text("Detect from the lyrics")');
  await page.waitForSelector(".panel .notice.error");
  ok(/no lyrics yet/.test(await page.textContent(".panel .notice.error")), "no lyrics: " + (await page.textContent(".panel .notice.error")).slice(0, 60));

  console.log("[setting]");
  await page.goto(B + "#/settings"); await page.waitForSelector("text=Save settings");
  ok(await page.isChecked('label:has-text("Detect the language of new songs") input'), "detection is on by default");
  await page.uncheck('label:has-text("Detect the language of new songs") input');
  await page.click('button:has-text("Save settings")'); await page.waitForSelector("text=Saved");
  const f3 = await add("Edith - Trois.wav", 37, TEXT.fr);
  ok((await row(f3.id)).language_source === "default", "switched off: a new French song keeps the default language");
  await page.check('label:has-text("Detect the language of new songs") input');
  await page.click('button:has-text("Save settings")'); await page.waitForSelector("text=Saved");

  console.log("[phone]");
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(B); await m.waitForSelector(".song");
  const mobile = await m.evaluate(() => { const c = document.querySelector(".lang-chips"); const r = c.getBoundingClientRect(); return { fits: r.right <= innerWidth + 1, scrollable: c.scrollWidth >= c.clientWidth, page: document.documentElement.scrollWidth <= innerWidth }; });
  ok(mobile.fits && mobile.page, "the language chips stay inside the screen (they scroll sideways when there are many)");
  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL LANGUAGE CHECKS PASSED");
})();
