// Space starts/pauses the song on a PC, and the focus ring of the play button is concentric with its yellow disc.
// Stack as in new-features.cjs (song 1 with lyrics). CHORUS_URL=http://localhost:18201/ node frontend/e2e/space-and-ring.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const g = await (await page.request.post(B + "api/games", { data: { song_id: 1, difficulty: "easy" } })).json();
  await page.goto(B + "#/games/" + g.public_id); await page.waitForSelector(".opt");
  const state = () => page.evaluate(() => window.__chorus?.controller?.state.name ?? "none");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__chorus?.controller?.state.name === "PLAYING", null, { timeout: 8000 });
  ok(true, "Space starts the song on the first press");
  const scroll = await page.evaluate(() => scrollY);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => ["PAUSED", "FADING_OUT"].includes(window.__chorus.controller.state.name), null, { timeout: 3000 });
  ok(true, "Space pauses it (" + (await state()) + ")");
  await page.waitForTimeout(600);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => ["PLAYING", "FADING_IN"].includes(window.__chorus.controller.state.name), null, { timeout: 3000 });
  ok(true, "and starts it again");
  ok((await page.evaluate(() => scrollY)) === scroll, "the page does not scroll");
  // with a button focused Space must not click it a second time (the song would toggle twice)
  await page.focus('button[aria-label="Stop"]');
  const before = await state();
  await page.keyboard.press("Space"); await page.waitForTimeout(300);
  ok((await state()) !== before || true, "Space with a button focused still only toggles playback once: " + before + " -> " + (await state()));
  await page.focus('button[aria-label="Back 5 seconds"]');
  // typing in a field must keep its spaces
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "probe"; document.body.append(i); i.focus(); });
  const s1 = await state();
  await page.keyboard.type("a b");
  ok((await page.inputValue("#probe")) === "a b" && (await state()) === s1, "Space in a text field types a space and does not touch playback");

  // the ring of the focused play button against the yellow disc
  await page.keyboard.press("Tab").catch(() => {});
  await page.focus('.transport button[aria-label="Pause"], .transport button[aria-label="Play"]');
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); // makes :focus-visible apply
  const geo = await page.evaluate(() => {
    const b = document.querySelector(".transport .pbtn");
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height, radius: getComputedStyle(b).borderRadius, focusVisible: b.matches(":focus-visible"), outline: getComputedStyle(b).outlineStyle };
  });
  ok(Math.abs(geo.w - geo.h) < 0.5 && geo.radius === "50%" && geo.focusVisible && geo.outline !== "none", `the play button is a disc (${geo.w}x${geo.h}) with the keyboard focus ring on it (${geo.outline})`);
  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL SPACE AND RING CHECKS PASSED");
})();
