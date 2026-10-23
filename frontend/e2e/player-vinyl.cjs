// The record, the one progress bar (PC and phone), the one play button and the Autoplay / fade settings (guide section 23).
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/player-vinyl.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const LINES = ["Ich gehe jeden Morgen zur Arbeit", "Du hast mich gefragt und ich hab nichts gesagt", "Wir fahren mit dem Zug zum Bahnhof", "Die Sonne scheint über der Stadt"];
const lrc = LINES.map((t, i) => `[00:${String(i * 4).padStart(2, "0")}.00] ${t}`).join("\n");

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, u, d) => (await page.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  const stamp = Date.now() % 100000;
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false }); // never ask the real dictionary services from a test
  const s = await (await page.request.post(B + "api/songs", { multipart: { file: { name: `PV - Song ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(30, 3301 + stamp * 7) } } })).json();
  await page.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) } } });
  const g = await api("POST", "games", { song_id: s.id, difficulty: "easy", mode: "choice" });

  console.log("[PC]");
  await page.goto(B + `#/games/${g.public_id}`); await page.waitForSelector(".transport");
  ok((await page.locator(".runway").count()) === 0, "the separate timeline row is gone");
  const dots = await page.locator(".transport .seek-tick").count();
  ok(dots === new Set(g.questions.map((q) => q.audio_start)).size && dots > 0, `the question dots sit on the progress bar (${dots})`);
  ok((await page.locator(".transport .seek-deadline").count()) === 1, "so does the mark where the audio waits");
  const wrap = await page.locator(".seek-wrap").boundingBox(), tk = await page.locator(".seek-tick").first().boundingBox();
  ok(tk.y > wrap.y - 4 && tk.y + tk.height < wrap.y + wrap.height + 4, "the dots are on the track, not above it");
  const times = await page.$$eval(".transport-time", (e) => e.map((x) => x.textContent));
  ok(times.length === 2 && /^0:00$/.test(times[0]) && /^0:\d\d$/.test(times[1]), "elapsed time at the left end, total at the right: " + times.join(" / "));
  const disc = async () => page.evaluate(() => { const m = /rotate\(([\d.]+)deg\)/.exec(document.querySelector(".vinyl-disc").style.transform); return m ? +m[1] : 0; });
  ok((await page.locator(".vinyl .cover").count()) === 1, "the record is in the game header (its label is the cover)");
  ok((await disc()) === 0, "it is still before play");
  await page.click('.transport button[aria-label="Play"]'); await page.waitForTimeout(1500);
  const a1 = await disc(); await page.waitForTimeout(250); const a2 = await disc();
  ok(a1 !== a2, `the record turns while the song plays (${a1.toFixed(0)}° → ${a2.toFixed(0)}°)`);
  await page.click('.transport button[aria-label="Pause"]');
  const ramp = []; for (let i = 0; i < 14; i++) { ramp.push(await disc()); await page.waitForTimeout(150); }
  const steps = ramp.slice(1).map((v, i) => (v - ramp[i] + 360) % 360);
  ok(steps[0] > steps[steps.length - 1] && steps.slice(0, 5).every((d, i, a) => i === 0 || d <= a[i - 1] + 2), "pausing slows it down gradually instead of stopping dead: " + steps.map((x) => x.toFixed(0)).join(","));
  await page.waitForTimeout(1500);
  const stopped = await disc(); await page.waitForTimeout(500);
  ok((await disc()) === stopped, `it stops where it is (${stopped.toFixed(0)}°) and stays there`);
  await page.click('.transport button[aria-label="Play"]'); const r2 = []; for (let i = 0; i < 6; i++) { r2.push(await disc()); await page.waitForTimeout(120); }
  ok(r2[0] >= stopped - 1 && r2[0] - stopped < 20, `playing again goes on from the same angle (${stopped.toFixed(0)}° → ${r2[0].toFixed(0)}°)`);
  await page.mouse.move(2, 2); await page.waitForTimeout(300); // no hover colour
  const play = await page.evaluate(() => { const b = document.querySelector(".transport .pbtn"); const r = b.getBoundingClientRect(); return { w: r.width, bg: getComputedStyle(b).backgroundColor }; });
  const lib = await (async () => { await page.goto(B); await page.waitForSelector(".play-btn:not(:disabled)"); return page.evaluate(() => { const b = document.querySelector(".play-btn:not(:disabled)"); return { bg: getComputedStyle(b).backgroundColor, w: b.getBoundingClientRect().width, cls: b.className }; }); })();
  ok(play.bg === lib.bg && /pbtn/.test(lib.cls), "the player and the library use the same yellow play disc");
  ok(play.w === 52 && lib.w === 44, `sizes: player ${play.w}, library row ${lib.w}`);

  console.log("[phone]");
  const m = await browser.newContext({ ...devices["iPhone 13"] });
  const ph = await m.newPage();
  ph.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await ph.goto(B + `#/games/${g.public_id}`); await ph.waitForSelector(".transport");
  ok((await ph.locator(".vinyl").count()) === 0 && (await ph.locator(".runway").count()) === 0, "no record and no timeline row on phones");
  const lay = await ph.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const t = r(".seek-wrap"), c = r(".transport .controls"), e = r(".transport-time.elapsed"), z = r(".transport-time.total"); return { trackAboveControls: t.bottom <= c.top + 1, timesBesideTrack: e.right <= t.left + 2 && z.left >= t.right - 2, dots: document.querySelectorAll(".seek-tick").length, edge: Math.max(...[...document.querySelectorAll(".seek-tick")].map((d) => d.getBoundingClientRect().right)) <= innerWidth }; });
  ok(lay.trackAboveControls && lay.timesBesideTrack && lay.dots > 0 && lay.edge, "two rows: the track with its dots and both times, the controls below: " + JSON.stringify(lay));
  const hit = await ph.locator(".seek-tick").first().evaluate((el) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return document.elementFromPoint(x + 12, y)?.className; });
  ok(/seek-tick|seek/.test(String(hit)), "a dot can be hit a little beside it (32 px target): " + hit);

  console.log("[answering a whole song as fast as the keys go, while it plays]");
  // many blanks in a burst used to end in "Maximum update depth exceeded" (a state update in an effect per answer) and a dead page
  const syl = ["ba", "ke", "mi", "so", "tu", "la", "ne", "ri", "po", "du"]; // a different made-up word every time: a word is only asked once per game
  const word = (n) => syl[n % 10] + syl[Math.floor(n / 10) % 10] + syl[Math.floor(n / 100) % 10] + "en";
  const many = Array.from({ length: 40 }, (_, i) => `[${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.00] ${[0, 1, 2, 3, 4].map((k) => word(i * 5 + k)).join(" ")}`).join("\n");
  const big = await (await page.request.post(B + "api/songs", { multipart: { file: { name: `PV - Burst ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(50, 3401 + stamp * 5) } } })).json();
  await page.request.post(B + `api/songs/${big.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(many) } } });
  const gb = await api("POST", "games", { song_id: big.id, difficulty: "expert", mode: "choice" });
  const crash = [];
  const crashPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  crashPage.on("pageerror", (e) => crash.push(e.message));
  crashPage.on("console", (m) => { if (m.type() === "error" && /Maximum update depth/.test(m.text())) crash.push(m.text()); });
  await crashPage.goto(B + `#/games/${gb.public_id}`); await crashPage.waitForSelector(".transport");
  await crashPage.click('.transport button[aria-label="Play"]'); await crashPage.waitForTimeout(600);
  for (let i = 0; i < gb.questions.length; i++) await crashPage.keyboard.press(String(1 + (i % 4)));
  await crashPage.waitForSelector(".finish-card", { timeout: 15000 });
  ok(gb.questions.length > 60, `a game with ${gb.questions.length} questions`);
  ok(crash.length === 0 && (await crashPage.locator(".transport").count()) === 1, "answering all of them in a burst while the song plays leaves the page working" + (crash.length ? ": " + crash[0].slice(0, 120) : ""));
  await crashPage.evaluate(() => { const a = document.querySelector("audio"); a.currentTime = Math.max(0, a.duration - 3); });
  await crashPage.waitForTimeout(500);
  const box = await crashPage.locator("input.seek").boundingBox();
  for (const f of [0.2, 0.9, 0.4, 0.99]) { await crashPage.mouse.click(box.x + 8 + (box.width - 16) * f, box.y + box.height / 2); await crashPage.waitForTimeout(80); }
  ok(crash.length === 0 && (await crashPage.evaluate(() => 1)) === 1, "and so does jumping about in the song afterwards");
  for (let i = 0; i < 60; i++) { const d = await api("GET", `games/${gb.public_id}`); if (d.questions.every((q) => q.answer)) break; await crashPage.waitForTimeout(500); } // let the server finish saving the answers
  await crashPage.close();

  console.log("[settings]");
  await page.goto(B + "#/settings"); await page.waitForSelector("text=Autoplay");
  const boxes = await page.locator(".panel:has(h2:text-is('Play queue')) input[type=checkbox]").evaluateAll((e) => e.map((x) => x.checked));
  ok(boxes.length === 2 && boxes[0] === true && boxes[1] === false, "Autoplay is on and Fade between songs is off by default");
  ok((await page.locator(".fade-length button").first().isDisabled()), "the fade length is dimmed while the fade is off");
  await page.evaluate(() => { const bs = [...document.querySelectorAll(".panel input[type=checkbox]")].filter((x) => x.closest(".check")?.textContent.includes("Fade between")); bs[0].click(); });
  await page.locator(".fade-length button", { hasText: "6 s" }).click();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save settings")?.click());
  await page.waitForTimeout(800);
  const saved = await api("GET", "settings");
  ok(saved.queue_fade === true && saved.queue_fade_seconds === 6 && saved.queue_autoplay === true, "the choices are saved: " + JSON.stringify([saved.queue_autoplay, saved.queue_fade, saved.queue_fade_seconds]));
  await browser.close();
})();
