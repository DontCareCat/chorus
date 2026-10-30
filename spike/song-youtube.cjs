const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 900 } })).newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto("http://localhost:18205/#/songs/1");
  await p.waitForSelector(".yt-player iframe", { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.click(".controls button[aria-label='Play']");
  await p.waitForTimeout(8000);
  await p.click("button:has-text('Sync start')");
  console.log("offset", await p.textContent(".offset-value"), "duration shown", await p.textContent(".transport-time"));
  await p.screenshot({ path: "/tmp/yt-song.png" });
  await b.close();
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
