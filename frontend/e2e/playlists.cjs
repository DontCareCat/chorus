// Playlists (guide section 18): create, add from the ⋮ menu and from a selection, open, remove, rename, delete; phone sheet.
// Isolated stack: backend :18201 with its own data dir.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/playlists.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  page.addInitScript(() => { new MutationObserver(() => document.querySelector(".confirm-actions .btn.danger")?.click()).observe(document, { subtree: true, childList: true }); }); // answers the app's own confirmation (Confirm.tsx) like the native dialog was accepted
  const api = async (m, p, d) => { const r = await page.request.fetch(B + "api/" + p, { method: m, ...(d ? { data: d } : {}) }); return r.status() === 204 ? null : r.json(); };
  const stamp = Date.now() % 100000;
  const names = [`Pl Alpha ${stamp}`, `Pl Beta ${stamp}`, `Pl Gamma ${stamp}`];
  for (const [i, n] of names.entries()) await page.request.post(B + "api/songs", { multipart: { file: { name: `PlBand - ${n}.wav`, mimeType: "audio/wav", buffer: wav(3 + i, 11 + i + stamp % 7) } } });
  const titles = async () => page.$$eval(".song .song-title", (e) => e.map((x) => x.textContent.replace(/removed from library$/, "").trim()));

  await page.goto(B); await page.waitForSelector(".song");
  console.log("[tabs]");
  ok(await page.locator(".library-tabs a[aria-current=page]").innerText() === "Songs", "Songs | Playlists is on the library page");
  await page.click('.library-tabs a:has-text("Playlists")');
  await page.waitForSelector(".page-head");
  ok(page.url().endsWith("#/playlists"), "the Playlists tab opens the list");
  await page.waitForSelector(".empty, .playlist-row");
  ok((await page.locator(".empty").count()) === 1 || (await page.locator(".playlist-row").count()) > 0, "empty state or the lists show");

  console.log("[create]");
  await page.click('button:has-text("New playlist")');
  await page.fill('.dialog input[type=text], .sheet input[type=text]', `Mine A ${stamp}`);
  await page.click('.dialog button[type=submit], .sheet button[type=submit]');
  await page.waitForFunction(() => /#\/playlists\/\d+$/.test(location.hash));
  const pid = Number(page.url().split("/").pop());
  ok(await page.locator("h1").innerText() === `Mine A ${stamp}`, "creating a playlist opens it");
  ok((await page.locator(".empty-card").count()) === 1, "an empty playlist says how to add songs");

  console.log("[add songs]");
  await page.click('.empty-card button:has-text("Add songs")');
  await page.locator(".pick-row", { hasText: names[0] }).click();
  await page.locator(".pick-row", { hasText: names[1] }).click();
  await page.click('.dialog .btn:has-text("Add"), .sheet .btn:has-text("Add")');
  await page.waitForSelector(".song");
  ok((await titles()).length === 2, "two songs were added: " + (await titles()).join(", "));

  console.log("[from the library menu]");
  await page.goto(B + "#/"); await page.waitForSelector(".song");
  await page.fill('input[type="search"]', names[2]); // a short list: the page does not scroll, which would close the menu
  await page.waitForFunction(() => document.querySelectorAll(".song").length === 1);
  const row = page.locator(".song", { hasText: names[2] });
  await row.locator(".kebab").click();
  await page.click('[role=menuitem]:has-text("Add to playlist")');
  await page.locator(".pick-row", { hasText: `Mine A ${stamp}` }).click();
  await page.waitForSelector('.notice.ok');
  ok((await api("GET", `playlists/${pid}`)).song_count === 3, "Add to playlist from the ⋮ menu: " + (await page.locator(".notice.ok").innerText()));
  await page.locator(".pick-row", { hasText: `Mine A ${stamp}` }).click(); // single song: a second tap removes
  await page.waitForTimeout(400);
  ok((await api("GET", `playlists/${pid}`)).song_count === 2, "tapping a ticked playlist takes the song out again");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.fill('input[type="search"]', `PlBand`);
  await page.waitForFunction(() => document.querySelectorAll(".song").length >= 3);

  console.log("[from a selection]");
  await page.evaluate(() => document.querySelectorAll(".song .pick")[0]?.click());
  await page.evaluate(() => document.querySelectorAll(".song .pick")[1]?.click());
  await page.click('.select-bar [aria-haspopup="menu"]'); // the bar's more-actions menu
  await page.click('.menu-popover button:has-text("Add to playlist"), .sheet button:has-text("Add to playlist"), [role="menu"] button:has-text("Add to playlist")');
  await page.fill('.new-playlist input', `Mine B ${stamp}`);
  await page.click('.new-playlist button[type=submit]');
  await page.waitForSelector('.notice.ok');
  const lists = await api("GET", "playlists");
  ok(lists.find((l) => l.name === `Mine B ${stamp}`)?.song_count === 2, "a new playlist created from the dialog holds the selected songs");

  console.log("[the playlist page]");
  await page.goto(B + `#/playlists/${pid}`); await page.waitForSelector(".song");
  await page.locator(".song").first().locator(".kebab").click();
  await page.click('[role=menuitem]:has-text("Remove from playlist")');
  await page.waitForFunction(() => document.querySelectorAll(".song").length === 1);
  ok(true, "Remove from playlist takes the song out of this list only");
  ok((await api("GET", "songs")).length >= 3, "the song is still in the library");
  await page.locator('.playlist-head .kebab').click();
  await page.click('[role=menuitem]:has-text("Rename")');
  await page.fill('.dialog input[type=text]', `Mine A2 ${stamp}`);
  await page.click('.dialog button[type=submit]');
  await page.waitForFunction((n) => document.querySelector("h1")?.textContent === n, `Mine A2 ${stamp}`);
  ok(true, "rename");
  await page.locator('.playlist-head .kebab').click();
  await page.click('[role=menuitem]:has-text("Delete playlist")');
  await page.waitForFunction(() => location.hash === "#/playlists");
  ok((await api("GET", "playlists")).every((l) => l.id !== pid), "delete playlist (songs stay)");

  console.log("[phone]");
  const m = await browser.newContext({ ...devices["iPhone 13"] });
  const ph = await m.newPage();
  ph.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await ph.goto(B + "#/playlists"); await ph.waitForSelector(".playlist-row");
  const box = await ph.locator(".library-tabs").boundingBox();
  ok(box && box.x >= 0 && box.x + box.width <= 390, "tabs fit on a phone");
  await ph.locator(".playlist-row .kebab").first().click();
  await ph.waitForSelector(".sheet");
  ok(true, "the playlist menu is a sheet on phones");
  await browser.close();
})();
