// Library bulk delete: select mode, select all shown, remove, and the settings dropdown arrow. Isolated stack as in layout-audit.cjs.
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(B + "#/settings"); await page.waitForSelector("select");
  const sel = await page.evaluate(() => { const s = document.querySelector("select"); const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { appearance: cs.appearance, pr: cs.paddingRight, pl: cs.paddingLeft, pos: cs.backgroundPosition, w: r.width }; });
  console.log(sel); ok(sel.appearance === "none" && parseFloat(sel.pr) > 30, "select has its own arrow with room");
  await page.screenshot({ path: "/tmp/settings-select.png" });
  await page.goto(B); await page.waitForSelector(".song");
  const before = await page.locator(".song").count();
  await page.click("text=Select >> nth=0");
  await page.click("text=/Select all/");
  ok((await page.locator(".pick:checked").count()) === before, "select all ticks every shown song");
  await page.uncheck(".pick >> nth=0");
  await page.click("text=/^Remove \\d+/");
  await page.waitForFunction((n) => document.querySelectorAll(".song").length === n - (n - 1), before, { timeout: 8000 }).catch(() => {});
  ok((await page.locator(".song").count()) === 1, "the ticked songs are gone, the unticked one stays");
  await browser.close();
})();
