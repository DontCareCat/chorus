// Reordering a playlist by dragging (guide section 16): the grip with the mouse, hold-and-drag on touch, animated, Esc cancels, Alt+arrows.
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/reorder.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const api = async (m, p, d) => { const r = await page.request.fetch(B + "api/" + p, { method: m, ...(d ? { data: d } : {}) }); return r.status() === 204 ? null : r.json(); };
  const stamp = Date.now() % 100000;
  const ids = [];
  for (const [i, n] of ["One", "Two", "Three", "Four"].entries()) ids.push((await (await page.request.post(B + "api/songs", { multipart: { file: { name: `RoBand - Ro ${n} ${stamp}.wav`, mimeType: "audio/wav", buffer: wav(3 + i, 1009 + i * 131 + stamp * 7) } } })).json()).id);
  const pl = await api("POST", "playlists", { name: `Order ${stamp}` });
  await api("POST", `playlists/${pl.id}/songs`, { song_ids: ids });
  const titles = () => page.$$eval(".song .song-title", (e) => e.map((x) => x.textContent.trim().replace(/ \d+$/, "")));
  const server = async () => (await api("GET", `playlists/${pl.id}`)).songs.map((s) => s.title.replace(/ \d+$/, ""));

  await page.goto(B + `#/playlists/${pl.id}`); await page.waitForSelector(".song");
  ok((await titles()).join() === "Ro One,Ro Two,Ro Three,Ro Four", "starts in the saved order");
  ok((await page.locator(".grip").count()) === 4, "every row has a grip on a PC");

  console.log("[mouse]");
  const g = await page.locator(".song").nth(0).locator(".grip").boundingBox();
  const target = await page.locator(".song").nth(2).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 5, g.y + 60, { steps: 5 });
  await page.mouse.move(g.x + 5, target.y + target.height - 10, { steps: 12 });
  const mid = await page.evaluate(() => ({ drag: !!document.querySelector("li[data-dragging]"), shifted: [...document.querySelectorAll(".songs > li")].filter((l) => l.style.transform && !l.hasAttribute("data-dragging")).length }));
  ok(mid.drag && mid.shifted >= 1, `while dragging the row lifts and the others slide aside (${mid.shifted} moved)`);
  const tr = await page.evaluate(() => getComputedStyle(document.querySelector(".songs > li:not([data-dragging])")).transitionDuration);
  ok(tr === "0.2s", "the other rows animate over 200 ms: " + tr);
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok((await titles()).join() === "Ro Two,Ro Three,Ro One,Ro Four", "dropped after the third row: " + (await titles()).join());
  ok((await server()).join() === "Ro Two,Ro Three,Ro One,Ro Four", "the new order is saved on the server");
  ok(await page.evaluate(() => ![...document.querySelectorAll(".songs > li")].some((l) => l.style.transform || l.style.transition)), "no leftover transforms after the drop");
  await page.reload(); await page.waitForSelector(".song");
  ok((await titles()).join() === "Ro Two,Ro Three,Ro One,Ro Four", "it survives a reload");

  console.log("[Esc and short moves]");
  const g2 = await page.locator(".song").nth(0).locator(".grip").boundingBox();
  await page.mouse.move(g2.x + 5, g2.y + 20); await page.mouse.down(); await page.mouse.move(g2.x + 5, g2.y + 260, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.waitForTimeout(400);
  ok((await titles()).join() === "Ro Two,Ro Three,Ro One,Ro Four", "Esc cancels the drag");

  console.log("[keyboard]");
  await page.locator(".song").nth(3).locator(".grip").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(300);
  ok((await titles()).join() === "Ro Two,Ro Three,Ro Four,Ro One", "Alt+ArrowUp moves the focused row up");
  ok(/Moved to position 3 of 4/.test(await page.locator('[role=status].sr-only').innerText()), "and says where it went");

  console.log("[touch]");
  const m = await browser.newContext({ ...devices["iPhone 13"] });
  const ph = await m.newPage();
  ph.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await ph.goto(B + `#/playlists/${pl.id}`); await ph.waitForSelector(".song");
  ok((await ph.locator(".grip").count()) === 0, "no grip on a phone");
  const fire = (type, x, y) => ph.evaluate(([t, x, y]) => { const el = t === "pointerdown" ? document.querySelectorAll(".songs > li")[0].querySelector(".song-text") : document.elementFromPoint(x, y) ?? document.body; el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y, isPrimary: true })); }, [type, x, y]);
  const r0 = await ph.locator(".song").nth(0).boundingBox(); const r2 = await ph.locator(".song").nth(2).boundingBox();
  await fire("pointerdown", 150, r0.y + 30);
  await ph.waitForTimeout(200);
  ok(!(await ph.evaluate(() => !!document.querySelector("li[data-dragging]"))), "not yet before the 350 ms hold");
  await ph.waitForTimeout(300);
  ok(await ph.evaluate(() => !!document.querySelector("li[data-dragging]")), "after the hold the row lifts");
  for (let i = 1; i <= 8; i++) { await fire("pointermove", 150, r0.y + 30 + ((r2.y + r2.height - r0.y - 40) * i) / 8); await ph.waitForTimeout(20); }
  await fire("pointerup", 150, r2.y + r2.height - 10);
  await ph.waitForTimeout(450);
  ok((await ph.$$eval(".song .song-title", (e) => e.map((x) => x.textContent.trim().replace(/ \d+$/, "")))).join() === "Ro Three,Ro Four,Ro Two,Ro One", "hold and drag reorders on a phone: " + (await ph.$$eval(".song .song-title", (e) => e.map((x) => x.textContent.trim()))).join());
  await browser.close();
})();
