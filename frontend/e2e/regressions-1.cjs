// Beta 0.2.0 regressions (beta.25): the focus animation of the lyric window, answer numbers centred in their circles, the dictionary badge centred
// over its icon, the Add word inputs in the app's input style, no top hamburger menu.
// Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/regressions-1.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const wait = (p, ms) => p.waitForTimeout(ms);

/** Offset (px) of the ink of the element's text from the centre of its box, from a screenshot. */
async function inkOffset(page, el) {
  const png = (await el.screenshot()).toString("base64");
  const cssW = (await el.boundingBox()).width;
  return page.evaluate(async ([b64, cssW]) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]]; // the corner is the page colour
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    const cx = c.width / 2, cy = c.height / 2, k = c.width / cssW, r = c.width / 2 - 3.5 * k; // inside the circle's own border (1 px + anti-aliasing)
    for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
      if (Math.hypot(xx - cx, yy - cy) > r) continue;
      const i = (yy * c.width + xx) * 4;
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 90) { minX = Math.min(minX, xx); maxX = Math.max(maxX, xx); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy); }
    }
    return { dx: ((minX + maxX + 1) / 2 - cx) / k, dy: ((minY + maxY + 1) / 2 - cy) / k, ink: maxX >= 0 };
  }, [png, cssW]);
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false, queue_fade: false });
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] wort${i} kommt schnell zurueck und ein langer Satz ${stamp}`).join("\n");
  const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `R1 - Song ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(70, 3301 + stamp) } } })).json();
  await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const g = await api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });

  for (const [name, dev] of [["phone", devices["Pixel 7"]], ["desktop", { viewport: { width: 1280, height: 800 } }]]) {
    console.log(`[${name}]`);
    const ctx = await browser.newContext(dev);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("PAGEERROR", e.message));

    // top bar has no hamburger menu; the account stays reachable
    await p.goto(B + "#/");
    await p.waitForSelector(".topbar");
    ok((await p.locator(".menu-btn, .burger, .menu-panel").count()) === 0, "no hamburger button or menu panel");
    if (name === "phone") { // the top bar has no room for Guest + Sign in + Create account: on a phone the account is in Settings > Account
      ok((await p.locator(".topbar .account").count()) === 0 && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), "no account in the phone's top bar, and the page is no wider than the screen");
      await p.goto(B + "#/settings"); await p.waitForSelector("#settings-account");
      ok((await p.locator('#settings-account a:has-text("Sign in")').count()) === 1, "Settings > Account has Sign in");
      await p.goto(B + "#/");
    } else ok((await p.locator(".topbar .account").count()) === 1, "the account (sign in / out) is in the top bar");

    // dictionary badge: centred over the icon, inside the tab
    if (name === "phone") {
      await p.evaluate(() => { const n = document.querySelector('.main-nav a[data-tab="dictionary"] .tab-icon'); if (n && !n.querySelector(".nav-badge")) { const b = document.createElement("small"); b.className = "nav-badge"; b.textContent = "3275"; n.append(b); } });
      const r = await p.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); const tab = q('.main-nav a[data-tab="dictionary"]'), ic = q('.main-nav a[data-tab="dictionary"] .tab-icon svg, .main-nav a[data-tab="dictionary"] .tab-icon .icon'), b = q(".main-nav .nav-badge"); return { tabL: tab.left, tabR: tab.right, tabMid: (tab.left + tab.right) / 2, icL: ic.left, icR: ic.right, bL: b.left, bR: b.right }; });
      ok(r.bL >= r.tabL && r.bR <= r.tabR, `the 4-digit badge stays inside its tab (${r.bL.toFixed(0)}-${r.bR.toFixed(0)} in ${r.tabL.toFixed(0)}-${r.tabR.toFixed(0)})`);
      ok(r.bL < r.icR && r.bL > r.icL, "the badge sits on the icon's top-right corner, not at the far edge of the tab");
    }

    // Add word inputs: the app's input style
    await p.goto(B + "#/dictionary");
    await p.getByRole("button", { name: /add word/i }).first().click();
    await p.waitForSelector(".exchange input[type=text]");
    const st = await p.$$eval(".exchange input[type=text]", (els) => els.map((e) => { const c = getComputedStyle(e); return { h: e.getBoundingClientRect().height, r: c.borderTopLeftRadius, bw: c.borderTopWidth, fs: c.fontSize }; }));
    ok(st.length >= 3 && st.every((x) => x.h === 44 && x.bw === "1px" && x.fs === "16px"), "Add word text boxes: 44 px high, 1 px border, 16 px text: " + JSON.stringify(st[0]));
    const sel = await p.evaluate(() => { const i = getComputedStyle(document.querySelector(".exchange input[type=text]")), s = document.querySelector(".exchange .select-btn, .exchange select"); return s ? { ir: i.borderTopLeftRadius, sr: getComputedStyle(s).borderTopLeftRadius, ih: document.querySelector(".exchange input[type=text]").getBoundingClientRect().height, sh: s.getBoundingClientRect().height } : null; });
    ok(!sel || (sel.ir === sel.sr && Math.abs(sel.ih - sel.sh) <= 2), "the inputs match the language select next to them: " + JSON.stringify(sel));
    await p.keyboard.press("Escape");

    // game: answer numbers centred in their circles; the focus line grows over time
    await p.goto(B + `#/games/${g.public_id}`);
    await p.waitForSelector(".opt-key"); await wait(p, 700);
    const offs = [];
    for (const k of await p.locator(".opt-key").all()) offs.push(await inkOffset(p, k));
    ok(offs.length === 4 && offs.every((o) => o.ink && Math.abs(o.dx) <= 1 && Math.abs(o.dy) <= 0.6), "answer numbers are centred in their circles (ink offset px): " + offs.map((o) => `${o.dx.toFixed(1)},${o.dy.toFixed(1)}`).join(" | "));

    await p.evaluate(() => { window.__sizes = []; });
    const first = await p.evaluate(() => getComputedStyle(document.querySelector('.lw-line[data-d="0"]')).fontSize);
    // jump to another question: its line must grow gradually, not at once
    const target = p.locator('.lw-line[data-qid]').nth(3);
    await target.evaluate((el) => { const lw = el; window.__t0 = performance.now(); window.__samples = []; const tick = () => { window.__samples.push(parseFloat(getComputedStyle(lw).fontSize)); if (performance.now() - window.__t0 < 700) requestAnimationFrame(tick); }; tick(); });
    await target.click({ force: true });
    await wait(p, 800);
    const samples = await p.evaluate(() => window.__samples);
    const distinct = new Set(samples.map((x) => x.toFixed(1)));
    ok(distinct.size >= 5 && Math.max(...samples) > Math.min(...samples) + 3, `the line changes size gradually: ${distinct.size} sizes between ${Math.min(...samples)} and ${Math.max(...samples)} px`);
    const mid = await p.evaluate(() => { const vp = document.querySelector(".lyric-window").getBoundingClientRect(), el = document.querySelector('.lw-line[data-d="0"]').getBoundingClientRect(); return { dy: Math.abs((el.top + el.bottom) / 2 - (vp.top + vp.bottom) / 2), h: vp.height }; });
    ok(mid.dy < mid.h * 0.15, `after the animation the focus line is in the middle of the window (off by ${mid.dy.toFixed(0)} px)`);
    await ctx.close();
  }
  await browser.close();
})();
