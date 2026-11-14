// Beta 0.2.2: tablets held upright get one centred group of five 96px tabs (480px at most); phones keep five columns; the queue bar keeps its sides;
// unselected tabs are --text-2; the header starts 12px under the status bar inset.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/nav-layout.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext(); const bp = await boot.newPage();
  await bp.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } });
  const s = await (await bp.request.post(B + "api/songs", { multipart: { file: { name: `Band - Nav ${Date.now() % 100000}.wav`, mimeType: "audio/wav", buffer: wav(30, 3) } } })).json();
  const st = await boot.storageState();
  for (const scheme of ["light", "dark"]) for (const [name, opts, tablet] of [["phone 390", devices["iPhone 13"], false], ["small phone 360", { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }, false], ["tablet 820", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, true], ["tablet 744", { viewport: { width: 744, height: 1133 }, isMobile: true, hasTouch: true }, true]]) {
    console.log(`[${name}, ${scheme}]`);
    const ctx = await browser.newContext({ ...opts, storageState: st, colorScheme: scheme });
    await ctx.addInitScript((id) => sessionStorage.setItem("chorus_queue", JSON.stringify({ items: [{ songId: id, difficulty: "easy", mode: "choice" }], cursor: 0 })), s.id);
    const p = await ctx.newPage();
    await p.goto(B + "#/settings"); await p.waitForSelector(".queue-bar"); await p.waitForTimeout(600);
    const m = await p.evaluate(() => {
      const links = [...document.querySelectorAll('.main-nav[data-variant="tabs"] a')].map((a) => a.getBoundingClientRect());
      const probe = document.createElement("i"); probe.style.color = "var(--text-2)"; document.body.appendChild(probe);
      const t2 = getComputedStyle(probe).color; probe.remove();
      const idle = [...document.querySelectorAll('.main-nav[data-variant="tabs"] a:not([aria-current])')].map((a) => getComputedStyle(a).color);
      const q = document.querySelector(".queue-bar").getBoundingClientRect(), h = document.querySelector(".topbar"), w = document.querySelector(".wordmark").getBoundingClientRect();
      return { n: links.length, widths: links.map((r) => Math.round(r.width)), left: links[0].left, right: links[links.length - 1].right, iw: innerWidth, t2, idle, qL: q.left, qR: innerWidth - q.right, headTop: w.top, pad: getComputedStyle(h).paddingTop, sw: document.documentElement.scrollWidth };
    });
    const group = m.right - m.left;
    if (tablet) {
      ok(m.widths.every((w) => w === 96) && group <= 481, `five 96px tabs in a group of ${Math.round(group)}px`);
      ok(Math.abs(m.left - (m.iw - m.right)) <= 1.5, `the group is centred (${Math.round(m.left)} left, ${Math.round(m.iw - m.right)} right)`);
      ok(Math.abs(m.qL - 24) <= 1 && Math.abs(m.qR - 24) <= 1 || (m.qL >= 24 && Math.abs(m.qL - m.qR) <= 1), `the queue bar keeps 24px sides (${m.qL}, ${m.qR})`);
    } else {
      ok(m.n === 5 && Math.abs(m.left) < 1 && Math.abs(m.iw - m.right) < 1, `phone: the five tabs fill the width (${Math.round(m.left)}..${Math.round(m.right)} of ${m.iw})`);
    }
    ok(m.idle.length === 4 && m.idle.every((c) => c === m.t2), "tabs that are not selected use --text-2");
    ok(parseFloat(m.pad) >= 12 && m.headTop >= 12, `the header starts 12px below the top (padding ${m.pad}, logo at ${Math.round(m.headTop)})`);
    ok(m.sw <= m.iw, "no sideways scroll");
    await ctx.close();
  }
  await browser.close();
})();
