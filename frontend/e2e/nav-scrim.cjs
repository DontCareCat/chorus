// Beta 0.2.2: the bottom scrim is one smooth gradient and nothing else: a stripe of the opposite colour under the nav stays untouched at the scrim's top and
// is covered a little more at every step toward the screen edge, with and without the queue bar; no solid band, no box.
//   CHORUS_URL=http://localhost:18201/ node frontend/e2e/nav-scrim.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext();
  const bp = await boot.newPage();
  await bp.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } });
  const s = await (await bp.request.post(B + "api/songs", { multipart: { file: { name: `Band - Scrim ${Date.now() % 100000}.wav`, mimeType: "audio/wav", buffer: wav(30, 9) } } })).json();
  const st = await boot.storageState();
  const reader = await browser.newPage();
  const column = async (png, x) => reader.evaluate(async ({ b64, x }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const out = []; for (let y = 0; y < img.height; y++) { const [r, gg, bb] = g.getImageData(x, y, 1, 1).data; out.push(0.2126 * r + 0.7152 * gg + 0.0722 * bb); } return out;
  }, { b64: png.toString("base64"), x });
  for (const scheme of ["dark", "light"]) for (const queue of [false, true]) for (const [vw, vh, nm] of [[390, 844, "phone"], [844, 390, "landscape"]]) {
    console.log(`[${scheme}, ${queue ? "with" : "without"} queue bar, ${nm}]`);
    const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1, viewport: { width: vw, height: vh }, storageState: st, colorScheme: scheme });
    if (queue) await ctx.addInitScript((id) => sessionStorage.setItem("chorus_queue", JSON.stringify({ items: [{ songId: id, difficulty: "easy", mode: "choice" }], cursor: 0 })), s.id);
    const p = await ctx.newPage();
    await p.goto(B + "#/settings"); await p.waitForSelector(".scard"); await p.waitForTimeout(700);
    if (queue) await p.waitForSelector(".queue-bar");
    const base = await column(await p.screenshot(), 3);
    const bgLum = base[Math.round(vh * 0.4)];
    const stripeLum = scheme === "dark" ? 255 : 0;
    const info = await p.evaluate(({ stripeLum }) => {
      const f = document.querySelector(".nav-fade").getBoundingClientRect();
      const stripe = document.createElement("div"); stripe.id = "stripe";
      stripe.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${Math.round(innerHeight * 0.7)}px;z-index:18;background:${stripeLum ? "#fff" : "#000"}`;
      document.body.appendChild(stripe);
      return { top: f.top, h: f.height, ih: innerHeight, bgLum: 0, stripe: stripeLum };
    }, { stripeLum });
    info.bgLum = bgLum;
    await p.waitForTimeout(200);
    const png = await p.screenshot();
    const col = await column(png, 3);
    const top = Math.round(info.top), end = info.ih;
    const above = col[top - 6], atTop = col[top], mid = col[Math.round((top + end) / 2)], last = col[end - 1];
    ok(Math.abs(above - info.stripe) < 3 && Math.abs(atTop - info.stripe) < 0.08 * Math.abs(info.bgLum - info.stripe), `the top of the scrim leaves the content as it is (${above.toFixed(0)}, ${atTop.toFixed(0)} against ${info.stripe})`);
    ok(Math.abs(last - info.bgLum) < 6, `the page colour at the screen edge (${last.toFixed(0)} against ${info.bgLum.toFixed(0)})`);
    const cover = (y) => Math.abs(col[top + y] - info.stripe) / Math.abs(info.bgLum - info.stripe); // how much of the page colour is over the stripe at y px below the scrim's top
    const c10 = cover(10), c22 = cover(22), c36 = cover(36);
    ok(Math.abs(c10 - 0.45) < 0.1 && Math.abs(c22 - 0.75) < 0.1 && Math.abs(c36 - 0.92) < 0.06, `the curve: ${(c10 * 100).toFixed(0)}% at 10px, ${(c22 * 100).toFixed(0)}% at 22px, ${(c36 * 100).toFixed(0)}% at 36px (45, 75, 92)`);
    let prev = -1, steady = true;
    for (let y = 0; y <= 48; y++) { const c = cover(y); if (c + 0.02 < prev) steady = false; prev = c; }
    ok(steady, "it only ever grows over the first 48px (no step back)");
    ok(Math.abs(col[top + 52] - info.bgLum) < 4 && Math.abs(col[end - 1] - info.bgLum) < 4, "the page colour from the bar's top edge (48px) down, to the screen edge");
    ok(await p.evaluate(() => { const n = document.querySelector(".main-nav"); const cs = getComputedStyle(n); return cs.backgroundColor === "rgba(0, 0, 0, 0)" && cs.boxShadow === "none"; }), "the tab bar itself paints nothing");
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".nav-fade")).pointerEvents === "none"), "taps go through the scrim");
    await ctx.close();
  }
  await browser.close();
})();
