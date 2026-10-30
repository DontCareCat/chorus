// Throwaway spike: can the IFrame player list the videos of a public playlist without an API key?
const { chromium } = require("playwright");
const LIST = process.argv[2] || "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";
(async () => {
  const http = require("http");
  const html = `<!doctype html><div id=p></div><script src="https://www.youtube.com/iframe_api"></script><script>
  window.res = { ids: null, err: null };
  window.onYouTubeIframeAPIReady = () => { window.pl = new YT.Player("p", { width: 320, height: 200, playerVars: { listType: "playlist", list: "${LIST}" },
    events: { onReady: () => { const t = Date.now(); const poll = setInterval(() => { const ids = window.pl.getPlaylist(); if (ids && ids.length) { window.res.ids = ids; window.res.ms = Date.now() - t; clearInterval(poll); } }, 200); }, onError: (e) => { window.res.err = e.data; } } }); };</script>`;
  const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(html); }).listen(18310);
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("http://localhost:18310/");
  await p.waitForFunction(() => window.res && (window.res.ids || window.res.err), null, { timeout: 30000 }).catch(() => {});
  console.log(JSON.stringify(await p.evaluate(() => window.res)));
  await b.close(); srv.close();
})();
