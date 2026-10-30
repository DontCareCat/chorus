const { chromium } = require("playwright");
(async () => {
  const http = require("http"), fs = require("fs");
  const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(fs.readFileSync(__dirname + "/yt-spike.html")); }).listen(18300);
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const p = await (await b.newContext({ viewport: { width: 400, height: 700 } })).newPage();
  await p.goto("http://localhost:18300/?v=" + (process.argv[2] || "dQw4w9WgXcQ"));
  try { await p.waitForFunction(() => window.__spike && window.__spike.done, null, { timeout: 90000 }); } catch {}
  console.log(JSON.stringify(await p.evaluate(() => window.__spike), null, 1));
  await b.close(); srv.close();
})();
