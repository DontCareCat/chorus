// Real-browser checks of the Dictionary page with a big dictionary: infinite scroll (the next page loads as the end of the list
// comes near) and select mode (long press on a phone, Select on a PC; Remove, Pause, Select all, Back / Esc / X).
// Stack: backend on its own port and data dir with the built frontend, the dictionary filled with seed-words.py:
//   python3 frontend/e2e/seed-words.py <data-dir>/app.db 3275
//   CHORUS_URL=http://localhost:18301/ node frontend/e2e/dictionary-bulk.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18301/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await phone.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.addInitScript(() => { new MutationObserver(() => document.querySelector(".confirm-actions .btn.danger")?.click()).observe(document, { subtree: true, childList: true }); }); // says yes to the app's own confirmation
  const api = async (path, init) => (await page.request.fetch(B + "api/" + path, init)).json();
  const start = (await api("dictionary?limit=1")).total;
  ok(start >= 1000, `the dictionary has ${start} words (seed-words.py)`);
  const rows = () => page.locator(".words > li").count();
  const bar = () => page.locator(".select-bar strong").textContent();
  const longPress = (i) => page.locator(".word-main").nth(i).evaluate(async (el) => {
    const r = el.getBoundingClientRect(), at = { bubbles: true, pointerType: "touch", isPrimary: true, clientX: r.left + 40, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", at));
    await new Promise((res) => setTimeout(res, 650));
    el.dispatchEvent(new PointerEvent("pointerup", at));
    el.click();
  });

  console.log("[infinite scroll, phone]");
  await page.goto(B + "#/dictionary");
  await page.waitForSelector(".words > li");
  ok(await rows() === 100, `the first page: ${await rows()} words`);
  ok(await page.locator("button", { hasText: "Show more" }).count() === 0, "no Show more button");
  for (const want of [200, 300]) {
    await page.locator(".list-end").scrollIntoViewIfNeeded();
    await page.waitForFunction((n) => document.querySelectorAll(".words > li").length >= n, want, { timeout: 10000 }).catch(() => {});
    ok(await rows() >= want, `scrolled to the end: ${await rows()} words (wanted ${want})`);
  }
  const before = await rows();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  ok(await rows() === before, "nothing more loads at the top of the list");

  console.log("[select mode by long press]");
  ok(await page.locator(".dict-actions button", { hasText: "Select" }).count() === 0, "no Select button on a phone (a long press starts it)");
  await longPress(0);
  await page.waitForSelector(".select-bar");
  ok(await bar() === "1 selected", `a long press ticks the word: ${await bar()}`);
  ok(await page.locator(".word-detail").count() === 0, "the pressed word did not open");
  ok(await page.locator(".words .pick").first().isVisible(), "tick boxes show at the start of the rows");
  const head = await page.locator(".word-head").nth(0).boundingBox(), box = await page.locator(".words .pick").nth(0).boundingBox();
  ok(box.x + box.width <= head.x - 8, "the word moves right of its tick box");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "the page is no wider than the screen with the bar open");
  await page.locator(".word-main").nth(1).click();
  await page.locator(".word-main").nth(2).click();
  ok(await bar() === "3 selected", `taps tick more words: ${await bar()}`);
  await page.locator(".select-bar [aria-label=Remove]").click();
  await page.waitForSelector(".select-bar", { state: "detached" });
  await page.waitForSelector(".float-toast", { timeout: 5000 });
  ok((await page.textContent(".float-toast")).includes("Removed 3 words"), `toast: ${await page.textContent(".float-toast")}`);
  ok((await api("dictionary?limit=1")).total === start - 3, "three words are gone");

  console.log("[Select all, untick one, pause the rest]");
  await longPress(0);
  await page.waitForSelector(".select-bar");
  await page.locator(".select-bar .select-all").click();
  ok(await bar() === `${(start - 3).toLocaleString("en")} selected`, `Select all covers the words not loaded yet: ${await bar()}`);
  await page.locator(".words .pick").nth(1).click();
  ok(await bar() === `${(start - 4).toLocaleString("en")} selected`, `unticking one: ${await bar()}`);
  await page.locator(".select-bar [aria-label='More actions']").click();
  await page.locator("[role=menuitem]", { hasText: "Pause reviews" }).click();
  await page.waitForSelector(".select-bar", { state: "detached" });
  const counts = (await api("dictionary?limit=1")).status_counts;
  ok(counts.suspended === start - 4, `paused ${counts.suspended} words, one left as it was`);
  await api("dictionary/bulk", { method: "POST", data: { action: "resume", filter: { status: "all" }, exclude: [] } });

  console.log("[Back leaves select mode first]");
  await longPress(0);
  await page.waitForSelector(".select-bar");
  await page.goBack();
  await page.waitForSelector(".select-bar", { state: "detached" });
  ok(page.url().includes("#/dictionary"), "still on the Dictionary page after Back");
  ok(await page.locator(".words .pick").count() === 0, "tick boxes are gone");

  console.log("[PC: the Select button, Esc]");
  const pc = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pc.goto(B + "#/dictionary");
  await pc.waitForSelector(".words > li");
  await pc.locator(".dict-actions button", { hasText: "Select" }).click();
  await pc.waitForSelector(".select-bar");
  ok((await pc.textContent(".select-bar strong")) === "0 selected" && await pc.locator(".select-bar [aria-label=Remove]").isDisabled(), "Select opens the bar with nothing ticked; Remove waits");
  await pc.locator(".word-main").nth(0).click();
  ok((await pc.textContent(".select-bar strong")) === "1 selected", "a click ticks a word");
  await pc.keyboard.press("Escape");
  await pc.waitForSelector(".select-bar", { state: "detached" });
  ok(true, "Esc leaves select mode");
  await pc.locator(".list-end").scrollIntoViewIfNeeded();
  await pc.waitForFunction(() => document.querySelectorAll(".words > li").length >= 200, null, { timeout: 10000 }).catch(() => {});
  ok(await pc.locator(".words > li").count() >= 200, "infinite scroll on a PC too");

  await browser.close();
})();
