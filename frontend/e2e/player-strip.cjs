// Beta 0.2.1: the player's progress strip (one row, no rewind / swipe / total / dots), drag to seek with fade + pause, the gate at the first open question,
// loudness data, keyboard slider, toasts. Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/player-strip.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const SHOTS = process.env.SHOTS;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) { const env = 0.15 + 0.85 * Math.abs(Math.sin(i / 8000 / 3)); d.writeInt16LE(Math.round(Math.sin(i * seed / 800) * 9000 * env), 44 + i * 2); } return d; };
const syl = ["ba", "ke", "mi", "so", "tu", "la", "ne", "ri", "po", "du"];
const word = (n) => syl[n % 10] + syl[Math.floor(n / 10) % 10] + syl[Math.floor(n / 100) % 10] + "en";
const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false, queue_fade: false });
  const stamp = Date.now() % 100000;
  const lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i * 2).padStart(2, "0")}.00] ${[0, 1, 2, 3, 4].map((k) => word(i * 5 + k + stamp * 3)).join(" ")} und ein langer Satz`).join("\n");
  const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name: `PS - Strip ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(70, 7 + (stamp % 5)) } } })).json();
  await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const mk = () => api("POST", "games", { song_id: s.id, difficulty: "hard", mode: "choice" });

  for (const [label, opts, phone] of [["phone 390", { ...devices["iPhone 13"] }, true], ["PC 1280", { viewport: { width: 1280, height: 800 } }, false], ["phone landscape", { ...devices["iPhone 13 landscape"] }, true]]) {
    console.log(`[${label}]`);
    const ctx = await browser.newContext({ ...opts, colorScheme: process.env.SCHEME ?? "light" });
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    const g = await mk();
    await pg.goto(B + `#/games/${g.public_id}`); await pg.waitForSelector(".transport .strip"); await wait(pg, 800);

    // ---- structure
    const kids = await pg.$$eval(".transport-inner > *", (e) => e.map((x) => [...x.classList].find((c) => ["controls", "strip", "transport-time", "volume", "queue-btn"].includes(c))));
    ok(JSON.stringify(kids) === JSON.stringify(phone ? ["controls", "strip", "transport-time", "queue-btn"] : ["controls", "strip", "transport-time", "volume", "queue-btn"]), "one row: " + kids.join(" | "));
    ok((await pg.locator('.transport [aria-label^="Back 5"], .transport .swipe-hint, .transport input.seek, .transport .seek-tick, .state-line').count()) === 0, "no rewind, swipe hint, seek input, dots or state line");
    ok((await pg.locator('.transport [aria-label="Skip to next"]').count()) === 0, "no Skip to next in the player");
    const geo = await pg.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const t = r(".transport"), st = r(".strip"), p = r(".transport .pbtn"), q = r(".transport .queue-btn"), tm = r(".transport-time"), o = document.querySelector(".options"); return { barH: t.height, strip: [st.width, st.height], play: p.height, queue: q.height, timeW: tm.width, time: document.querySelector(".transport-time").textContent, rows: new Set([p, st, tm, q].map((x) => Math.round(x.top + x.height / 2))).size, gap: o ? t.top - o.getBoundingClientRect().bottom : 0, scrollW: document.documentElement.scrollWidth, w: innerWidth }; });
    console.log("   ", JSON.stringify(geo));
    if (phone) ok(Math.abs(geo.barH - 68) <= 1 && geo.play === 52 && geo.strip[1] === 44 && geo.queue === 44 && geo.timeW >= 48, "phone bar 68 high: play 52, strip 44, queue 44, time 48");
    else ok(Math.abs(geo.barH - 73) <= 2 && geo.strip[1] === 48 && geo.timeW >= 56, "PC bar 72 (+1 border): strip 48, time 56");
    ok(geo.rows <= 2, "everything is centred on one line");
    ok(/^-1:10$/.test(geo.time), "time left shown, not the total: " + geo.time);
    ok(geo.scrollW <= geo.w, "no horizontal overflow");
    const slider = await pg.getAttribute(".strip", "aria-valuetext");
    ok(slider === "0:00 of 1:10, 1:10 left", "slider text: " + slider);
    if (!phone) ok((await pg.locator(".transport .volume").count()) === 1, "volume control on PC");
    await wait(pg, 1500); // peaks decoded
    const stored = await pg.evaluate((id) => localStorage.getItem("chorus-peaks-" + id), s.id);
    ok(!!stored && /^70:/.test(stored), "the loudness is decoded once and kept: " + (stored ? stored.slice(0, 20) + "…" : stored));
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/strip-${phone ? "phone" : "pc"}-idle.png` });

    // ---- play: the strip slides and the time left counts down
    await pg.click('.transport [aria-label="Play"]'); await wait(pg, 2500);
    const audio = () => pg.evaluate(() => ({ paused: document.querySelector("audio").paused, t: document.querySelector("audio").currentTime }));
    let a = await audio();
    ok(!a.paused && a.t > 1, `playing (${a.t.toFixed(1)} s)`);
    const left1 = await pg.textContent(".transport-time");
    ok(/^-1:0\d$/.test(left1), "time left counts down: " + left1);

    // ---- drag backwards a little, then release: pauses during the drag, plays after
    const box = await pg.locator(".strip").boundingBox();
    const cy = box.y + box.height / 2, cx = box.x + box.width / 2;
    await pg.mouse.move(cx, cy); await pg.mouse.down();
    await pg.mouse.move(cx + 20, cy, { steps: 4 }); await wait(pg, 350);
    a = await audio();
    ok(a.paused, "the audio is paused while the strip is held");
    ok(await pg.getAttribute(".strip", "data-busy") === "true", "the strip shows it is being scrubbed");
    const bubble = await pg.textContent(".strip-bubble");
    ok(/^\d:\d\d · [+−]\d+ s$/.test(bubble), "the bubble shows the target and the change: " + bubble);
    ok(await pg.getAttribute(".transport-time", "data-busy") === "true", "the time left shows the target (bold)");
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/strip-${phone ? "phone" : "pc"}-drag.png` });
    await wait(pg, 400); // resting before the lift: no coasting
    await pg.mouse.up(); await wait(pg, 900);
    a = await audio();
    ok(!a.paused, "the audio plays again after the release");
    ok(await pg.getAttribute(".strip", "data-busy") === "false", "the strip is back to following the song");

    // ---- a tap does nothing
    const before = await audio();
    await pg.mouse.click(cx, cy); await wait(pg, 300);
    a = await audio();
    ok(!a.paused && a.t >= before.t, "a tap on the strip does nothing");

    // ---- forward is stopped at the first open question
    await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx - box.width * 0.45, cy, { steps: 12 });
    await wait(pg, 200);
    const toast = (await pg.locator(".float-toast, .last-answer, .kb-line").allTextContents()).join(" | ");
    ok(/Answer this one first/.test(toast), "the gate says so: " + toast);
    await wait(pg, 300); await pg.mouse.up(); await wait(pg, 600);
    a = await audio();
    ok(a.t < 12, `forward did not pass the first open question (${a.t.toFixed(1)} s)`);

    // ---- a paused song stays paused after a scrub
    await pg.click(".transport .pbtn"); await wait(pg, 250); await pg.click('.transport [aria-label="Pause"]'); await wait(pg, 400); // (it waited for the open question: play, then pause)
    const t0 = (await audio()).t;
    await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx + 25, cy, { steps: 5 }); await wait(pg, 300); await pg.mouse.up(); await wait(pg, 700);
    a = await audio();
    ok(a.paused, "a paused song stays paused after a scrub");
    ok(a.t < t0 || t0 === 0, `and it moved back (${t0.toFixed(1)} -> ${a.t.toFixed(1)} s)`);

    // ---- keyboard
    await pg.focus(".strip");
    await pg.keyboard.press("Home"); await wait(pg, 700);
    ok(Math.abs((await audio()).t) < 0.5, "Home goes to the start");
    await pg.keyboard.press("End"); await wait(pg, 800);
    ok((await audio()).t < 12, "End stops at the first open question: " + (await audio()).t.toFixed(1));
    const fx = await pg.$eval(".strip", (e) => getComputedStyle(e).outlineStyle);
    ok(fx !== "none", "focus ring on the strip");
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/strip-${phone ? "phone" : "pc"}-end.png` });
    await ctx.close();
  }
  await browser.close();
})();
