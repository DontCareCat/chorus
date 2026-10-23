// Library bulk delete: select mode, select all shown, remove, and the settings dropdown arrow. Isolated stack as in layout-audit.cjs.
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("dialog", (d) => d.accept());
  const wav = (seed) => { const n = 8000 * 5, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
  for (const [i, name] of ["A - One.wav", "B - Two.wav", "C - Three.wav"].entries()) await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(3 + i) } } });
  await page.goto(B + "#/settings"); await page.waitForSelector(".select-btn");
  const sel = await page.evaluate(() => { const s = document.querySelector(".select-btn"); const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { native: document.querySelectorAll("select").length, pr: cs.paddingRight, pl: cs.paddingLeft, w: r.width }; });
  console.log(sel); ok(sel.native === 0 && parseFloat(sel.pr) > 30 && parseFloat(sel.pl) >= 12, "dropdowns are ours (no native select) with room for the arrow");
  await page.screenshot({ path: "/tmp/settings-select.png" });
  await page.goto(B); await page.waitForSelector(".song");
  const before = await page.locator(".song").count();
  await page.evaluate(() => document.querySelector(".song-main .pick").click()); // a phone viewport: the boxes show only while selecting
  await page.check(".select-all"); // the summary checkbox selects everything the filter shows
  ok((await page.locator(".song-main .pick:checked").count()) === before, "select all ticks every shown song");
  await page.uncheck(".song-main .pick >> nth=0");
  await page.click(".select-bar >> text=Remove");
  await page.waitForFunction((n) => document.querySelectorAll(".song").length === n - (n - 1), before, { timeout: 8000 }).catch(() => {});
  ok((await page.locator(".song").count()) === 1, "the ticked songs are gone, the unticked one stays");
  await browser.close();
})();
