// The lyrics timing editor (beta 0.2.3): opens from the song menu, Set while playing, nudges, the order rule with its Undo toast, explicit Save (and the
// "Timing edited" tag), the leave dialog, export (preview and file), plain lyrics, the keys on a PC, no sideways scroll. Phone 390, phone on its side, PC 1280.
// Isolated stack: backend :18201 (own data dir) and fake-lrclib.   CHORUS_URL=http://localhost:18201/ node frontend/e2e/timing-editor.cjs
const { chromium, devices } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed = 1) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE(Math.round(Math.sin(i / (14 + seed)) * 6000), 44 + i * 2); return d; };
const LINES = ["Las luces suben despacio", "sobre el río de papel", "y tu voz se queda flotando", "entre el humo y el ayer", "", "No me dejes olvidar", "la canción que fue de los dos", "cada farol es una promesa"];
const stamp = (i) => `[00:${String(4 + i * 5).padStart(2, "0")}.00]`;

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const boot = await browser.newPage();
  const api = async (m, u, d) => (await boot.request.fetch(B + "api/" + u, { method: m, ...(d ? { data: d } : {}) })).json();
  await api("PUT", "settings", { ...(await api("GET", "settings")), translation_enabled: false, queue_fade: false, allow_unsynchronized_lyrics: true });
  const stampN = Date.now() % 100000;
  let seedN = 0;
  const mk = async (name, text) => {
    const s = await (await boot.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(60, 3 + (Date.now() % 100000) / 977 + ++seedN * 5) } } })).json();
    for (let i = 0; i < 20; i++) { // the automatic lookup that follows an upload may land after our own upload: upload again until the lyrics are ours
      await boot.request.post(B + `api/songs/${s.id}/lyrics/upload`, { multipart: { file: { name: "l.lrc", mimeType: "text/plain", buffer: Buffer.from(text) } } });
      await new Promise((r) => setTimeout(r, 300));
      const now = (await api("GET", "songs")).find((x) => x.id === s.id);
      if (now?.lyrics_status === "found") break;
    }
    return s;
  };

  for (const [label, opts, kind] of [["phone 390", { ...devices["iPhone 13"] }, "phone"], ["phone landscape", { ...devices["iPhone 13 landscape"] }, "land"], ["PC 1280", { viewport: { width: 1280, height: 800 }, acceptDownloads: true }, "wide"]]) {
    console.log(`[${label}]`);
    const song = await mk(`Mara Vell - Linterna ${label.replace(/\W/g, "")} ${stampN}.wav`, LINES.map((t, i) => `${stamp(i)} ${t}`).join("\n"));
    const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    const times = () => pg.$$eval(".tm-cell", (e) => e.map((x) => x.textContent));
    const secs = (t) => { const m = /^(\d+):(\d\d)\.(\d\d)$/.exec(t); return m ? +m[1] * 60 + +m[2] + +m[3] / 100 : null; };
    const noScroll = async (m) => ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), m);

    // ---- opens from the song menu (the old "Check lyrics timing" is gone)
    await pg.goto(B); await pg.waitForSelector(".song");
    const row = pg.locator(".song", { hasText: song.title }).first();
    await row.scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); // (a scroll closes the PC popover)
    await row.hover();
    await row.locator('button[aria-label^="More actions"]').click();
    await pg.waitForSelector(".song-menu, .song-sheet");
    const item = pg.getByRole("menuitem", { name: /Edit lyrics timing/ });
    ok(await item.count() === 1 && (await pg.getByRole("menuitem", { name: /Check lyrics timing/ }).count()) === 0, "the menu has Edit lyrics timing (it replaces Check lyrics timing)");
    ok(await pg.locator(".badge-new").count() === 1, "a NEW badge sits on it");
    ok(await pg.getByRole("menuitem", { name: /Export \.lrc file/ }).count() === 1, "and Export .lrc file after it");
    await item.evaluate((el) => el.click()); // (a scroll would close the PC popover)
    await pg.waitForSelector(".tm-row");
    ok(await pg.locator(".tm").getAttribute("data-kind") === kind, `the ${kind} drawing`);
    const texts0 = (await api("GET", `songs/${song.id}/lyrics/timing`)).lines.map((l) => l.text);
    const nLines = texts0.length;
    ok((await pg.locator(".tm-row").count()) === nLines && nLines >= 7, `one row per lyric line, in file order (${nLines})`);
    const first = await pg.locator(".tm-row[data-sel=true] .tm-cell").allTextContents();
    ok(first.length === 1 && first[0] === "0:04.00", `line 1 is chosen (${first.join("|")})`);
    ok((await pg.locator("#root, body").first().evaluate(() => !document.querySelector(".mainnav, .main-nav, .queue-bar"))), "no tab bar, rail or queue bar on this page");
    await noScroll("no sideways scroll");
    const padLeft = await pg.locator(".tm-row").first().evaluate((e) => { const r = e.getBoundingClientRect(), t = e.querySelector(".tm-cell").getBoundingClientRect(); return t.left - r.left; });
    ok(padLeft >= 12, `rows keep ${padLeft.toFixed(0)} px inside their edge (at least 12)`);
    ok(await pg.locator(".tm-text").first().evaluate((e) => !e.isContentEditable && !e.querySelector("input, textarea")), "the words are plain text, not editable");

    // ---- the ⋮ menu: every item has room (a wrapped item grows, nothing overlaps its neighbours)
    const menuOk = async (root, what) => {
      const r = await pg.evaluate((sel) => {
        const box = document.querySelector(sel);
        if (!box) return null;
        const items = [...box.querySelectorAll(".mi")];
        const rects = items.map((e) => e.getBoundingClientRect());
        let overlap = 0, cramped = 0;
        rects.forEach((r, i) => { if (i && r.top < rects[i - 1].bottom - 0.5) overlap++; });
        items.forEach((e, i) => { if (e.scrollHeight > e.clientHeight + 1 || rects[i].height < 43.5) cramped++; });
        return { n: items.length, overlap, cramped, wrapped: items.filter((e) => e.getBoundingClientRect().height > 60).length };
      }, root);
      ok(r && r.n >= 3 && r.overlap === 0 && r.cramped === 0, `${what}: ${r?.n} items, none overlap or overflow (${r?.wrapped} grew to two lines)`);
    };
    if (kind === "wide") await menuOk(".tm-whole", "the Whole song card");
    else {
      await pg.getByRole("button", { name: "More" }).click();
      await pg.waitForSelector(".tm-menu, .song-sheet");
      await menuOk(kind === "land" ? ".tm-menu" : ".song-sheet", kind === "land" ? "the popover" : "the sheet");
      await pg.keyboard.press("Escape"); await pg.waitForTimeout(500);
    }

    // ---- tip, play and Set through three lines
    ok(await pg.locator(".tm-hint").count() === 1, "the tip shows");
    await pg.locator('.tm-play').click(); await pg.waitForTimeout(1500);
    const before = await times();
    for (let i = 0; i < 3; i++) { await pg.locator(".tm-set").click(); await pg.waitForTimeout(500); }
    const after = await times();
    ok(after.slice(0, 3).every((t, i) => t !== before[i]), `three Sets gave lines 1-3 new times: ${after.slice(0, 3).join(", ")}`);
    const t = after.slice(0, 3).map(secs);
    ok(t[0] < t[1] && t[1] < t[2] && t[0] >= 1, "they follow the playback, in order");
    ok(await pg.locator(".tm-row[data-sel=true]").evaluate((e) => e.getAttribute("aria-label")).then((l) => /^Line 4,/.test(l)), "the next line is chosen after each Set");
    ok(await pg.locator(".tm-hint").count() === 0, "the tip closes with the first Set");
    ok(await pg.locator(".tm-row[data-edit=true]").count() === 3 && /edited [+−]/.test(await pg.locator(".tm-row").first().getAttribute("aria-label")), "edited rows say so in words (the change) and in colour");
    await pg.locator(".tm-play").click(); // pause
    ok(await pg.locator(".tm-head .btn:has-text('Save')").isEnabled(), "Save is on while there are unsaved changes");
    ok(/Unsaved changes/.test(await pg.locator(".tm-status").first().textContent()), "the status says Unsaved changes");

    // ---- nudge, undo
    await pg.locator(".tm-row").nth(1).click();
    const second = secs(await pg.locator(".tm-row").nth(1).locator(".tm-cell").textContent());
    await pg.getByRole("button", { name: "0.1 seconds later" }).click();
    ok(Math.abs(secs(await pg.locator(".tm-row").nth(1).locator(".tm-cell").textContent()) - second - 0.1) < 0.011, "+0.1 moves the chosen line by a tenth of a second");
    if (kind === "phone") await pg.getByRole("button", { name: "Undo" }).click(); else await pg.getByRole("button", { name: /^Undo/ }).first().click();
    ok(Math.abs(secs(await pg.locator(".tm-row").nth(1).locator(".tm-cell").textContent()) - second) < 0.011, "Undo takes the nudge back");
    // ---- the order rule: a line moved past its neighbour pushes it, with an Undo in the toast
    await pg.locator(".tm-row").nth(0).click();
    const orderBefore = (await times()).map(secs);
    let beforeClick = orderBefore;
    for (let i = 0; i < 12 && (await pg.locator(".tm-toast").count()) === 0; i++) { beforeClick = (await times()).map(secs); await pg.getByRole("button", { name: "0.1 seconds later" }).click(); }
    const afterPush = (await times()).map(secs);
    ok(afterPush.every((x, i) => i === 0 || x == null || afterPush[i - 1] == null || x > afterPush[i - 1]), "line 1 moved past line 2: the order still holds");
    ok(afterPush[1] > beforeClick[1], "line 2 was pushed ahead of line 1");
    ok(await pg.locator(".tm-toast").count() === 1 && /Moved \d+ more lines? to keep the order/.test(await pg.locator(".tm-toast").textContent()), "a toast says how many lines moved");
    const place = await pg.evaluate(() => {
      const t = document.querySelector(".tm-toast").getBoundingClientRect();
      const dock = document.querySelector(".tm-dock, .tm-bar")?.getBoundingClientRect();
      const set = document.querySelector(".tm-set")?.getBoundingClientRect();
      return { t: [t.left, t.right, t.top, t.bottom], dock: dock && [dock.left, dock.right, dock.top, dock.bottom], set: set && [set.left, set.right, set.top, set.bottom], w: innerWidth };
    });
    if (kind === "land") ok(place.t[0] >= place.dock[0] - 1 && place.t[1] <= place.dock[1] + 1 && place.t[3] <= place.set[2] + 1, "the Undo toast sits over the dock panel, above its Set button");
    else ok(place.t[3] <= place.dock[2] + 1, `the Undo toast sits above the ${kind === "wide" ? "player bar" : "dock"}`);
    await pg.locator(".tm-toast-undo").click();
    ok(Math.abs(secs((await times())[1]) - beforeClick[1]) < 0.011 && (await pg.locator(".tm-toast").count()) === 0, "Undo in the toast takes the move back");

    // ---- save, the tag, the shared edit
    await pg.locator(".tm-head .btn:has-text('Save')").click();
    await pg.waitForSelector(".tm-toast, .toast-lane .float-toast", { timeout: 4000 });
    await pg.waitForFunction(() => document.querySelector(".tm-head .btn:last-child")?.disabled === true, null, { timeout: 4000 });
    const saved = await api("GET", `songs/${song.id}/lyrics/timing`);
    ok(saved.edited === true && JSON.stringify(saved.lines.map((l) => l.text)) === JSON.stringify(texts0), "saved: the server has the edit, the words are untouched");
    ok(/Saved/.test(await pg.locator(".tm-status").first().textContent()), "the status says Saved");
    const gameLines = await api("POST", "games", { song_id: song.id, difficulty: "easy", mode: "choice" });
    ok(gameLines.lines.some((l) => Math.abs(l.audio_start - saved.lines[0].time) < 0.01), "a new game uses the edited times");

    // ---- leaving with unsaved changes
    await pg.getByRole("button", { name: "0.1 seconds later" }).first().click().catch(() => undefined);
    if (!(await pg.locator(".tm-head .btn:has-text('Save')").isEnabled())) await pg.getByRole("button", { name: /0\.\d seconds later/ }).last().click();
    await pg.getByRole("button", { name: "Back", exact: true }).click();
    ok(await pg.getByText("Save your timing changes?").count() === 1, "Back with unsaved changes asks first");
    const acts = await pg.evaluate(() => {
      const box = document.querySelector(".tm-actions");
      const bs = [...box.querySelectorAll(".btn")].map((b) => { const r = b.getBoundingClientRect(); return { t: r.top, l: r.left, r: r.right, w: r.width, h: r.height, text: b.textContent }; });
      const c = box.getBoundingClientRect();
      return { bs: bs.sort((a, b) => a.t - b.t || a.l - b.l), c: [c.left, c.right] };
    });
    if (kind === "wide") ok(new Set(acts.bs.map((b) => Math.round(b.t))).size === 1 && Math.abs(acts.bs[2].r - acts.c[1]) < 2 && acts.bs[2].text === "Save", "PC: the dialog buttons are one right-aligned row, the action last");
    else ok(acts.bs.length === 3 && acts.bs[0].text === "Save" && acts.bs[0].t < acts.bs[1].t && acts.bs[1].t < acts.bs[2].t && acts.bs.every((b) => b.h >= 51.5 && b.w >= acts.c[1] - acts.c[0] - 2) && acts.bs[2].text === "Keep editing", "touch: full-width 52 px stacked buttons, Save on top, Keep editing last");
    await pg.getByRole("button", { name: "Keep editing" }).click();
    ok(await pg.locator(".tm-row").count() > 0 && (await pg.getByText("Save your timing changes?").count()) === 0, "Keep editing stays");
    await pg.goBack().catch(() => undefined);
    await pg.waitForTimeout(300);
    ok(await pg.getByText("Save your timing changes?").count() === 1 || (await pg.locator(".tm-row").count()) > 0, "the browser's back also asks");
    if (await pg.getByText("Save your timing changes?").count()) await pg.getByRole("button", { name: "Discard" }).click();
    else { await pg.getByRole("button", { name: "Back", exact: true }).click(); await pg.getByRole("button", { name: "Discard" }).click(); }
    await pg.waitForTimeout(500);
    await pg.waitForSelector(".song", { timeout: 5000 });
    const tag = await pg.locator(".song", { hasText: song.title }).first().locator(".tag", { hasText: /timing edited/i }).count();
    ok(tag === 1, "the song row has the Timing edited tag");

    // ---- export (the dialog, then the file)
    await pg.goto(B + `#/songs/${song.id}/timing`); await pg.waitForSelector(".tm-row");
    if (kind === "wide") await pg.getByRole("button", { name: /Export \.lrc/ }).first().click();
    else { await pg.getByRole("button", { name: "More" }).click(); await pg.getByRole("menuitem", { name: /Export \.lrc file/ }).click(); }
    await pg.waitForSelector(".tm-lrc");
    const preview = await pg.locator(".tm-lrc").textContent();
    ok(/^\[ti:Linterna/.test(preview) && /\[ar:Mara Vell\]/.test(preview) && /\[re:Chorus\]/.test(preview) && /\[00:\d\d\.\d\d\]Las luces suben despacio/.test(preview), "the preview is the file");
    const fileName = await pg.locator(".tm-file span:last-child").textContent();
    ok(/^Mara Vell - Linterna.*\.lrc$/.test(fileName), `the file name is Artist - Title.lrc: ${fileName}`);
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.locator(".tm-actions .btn:not(.secondary)").click()]);
    const body = require("fs").readFileSync(await dl.path(), "utf8");
    ok(dl.suggestedFilename() === fileName && body === preview, "the download has that name and exactly the previewed text");
    ok(!body.startsWith("﻿") && body.endsWith("\n") && !body.includes("\r"), "UTF-8 without BOM, \\n line ends");
    await pg.waitForTimeout(300);

    // ---- keys on a PC
    if (kind === "wide") {
      await pg.locator(".tm-row").first().click();
      const k0 = await pg.locator(".tm-row[data-sel=true]").getAttribute("aria-label");
      await pg.keyboard.press("ArrowDown");
      ok((await pg.locator(".tm-row[data-sel=true]").getAttribute("aria-label")) !== k0, "ArrowDown chooses the next line");
      await pg.keyboard.press("ArrowRight");
      ok(await pg.locator(".tm-head .btn:has-text('Save')").isEnabled(), "→ nudges by 0.1 s");
      await pg.keyboard.press("Control+z");
      ok(await pg.locator(".tm-head .btn:has-text('Save')").isDisabled(), "Ctrl+Z undoes it");
      await pg.keyboard.press("Enter");
      ok(await pg.locator(".tm-head .btn:has-text('Save')").isEnabled(), "Enter sets the line to now");
      await pg.keyboard.press("Control+s");
      await pg.waitForFunction(() => document.querySelector(".tm-head .btn:last-child")?.disabled === true, null, { timeout: 4000 });
      ok(true, "Ctrl+S saves");
      await pg.keyboard.press(" ");
      await pg.waitForTimeout(400);
      ok((await pg.locator(".tm-play").getAttribute("aria-label")) === "Pause", "Space plays");
      await pg.keyboard.press(" ");
      ok(await pg.locator(".tm-keys .kbd").count() > 8, "the Keys list shows on a PC");
    }
    await noScroll("still no sideways scroll");
    await ctx.close();
  }

  // ---- a tablet held upright: the phone drawing, the header no wider than the list and dock
  console.log("[tablet upright 834]");
  {
    const song = await mk(`Mara Vell - Tablet ${stampN}.wav`, LINES.map((t, i) => `${stamp(i)} ${t}`).join("\n"));
    const ctx = await browser.newContext({ ...devices["iPad Pro 11"] });
    const pg = await ctx.newPage();
    await pg.goto(B + `#/songs/${song.id}/timing`); await pg.waitForSelector(".tm-row");
    const g = await pg.evaluate(() => { const r = (q) => { const e = document.querySelector(q).getBoundingClientRect(); return [e.left, e.right, e.width]; }; return { kind: document.querySelector(".tm").dataset.kind, head: r(".tm-head"), rows: r(".tm-rows"), dock: r(".tm-dock-in"), save: r(".tm-head .btn"), w: innerWidth }; });
    ok(g.kind === "phone", "a tablet held upright gets the phone drawing");
    ok(g.head[2] <= 680.5 && Math.abs((g.head[0] + g.head[1]) / 2 - g.w / 2) < 2, `the header is capped at ${g.head[2].toFixed(0)} px and centred`);
    ok(Math.abs(g.save[1] - (g.head[1] - 16)) < 2 && g.save[1] <= g.dock[1] + 17, "Save sits with the content, not at the screen edge");
    await ctx.close();
  }

  // ---- plain lyrics get timed
  console.log("[plain lyrics, phone 390]");
  const plain = await mk(`Mara Vell - Sin tiempo ${stampN}.wav`, LINES.join("\n"));
  const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true });
  const pg = await ctx.newPage();
  await pg.goto(B + `#/songs/${plain.id}/timing`); await pg.waitForSelector(".tm-row");
  const cells = await pg.$$eval(".tm-cell", (e) => e.map((x) => x.textContent));
  ok(cells.every((c) => c === "--:--.--"), "every line starts as --:--.--");
  ok(/no timing yet/.test(await pg.locator(".tm-hint").textContent()), "the tip says the lyrics have no timing yet");
  ok(/0 of \d+ lines timed/.test(await pg.locator(".tm-status").first().textContent()), "the status counts the timed lines");
  await pg.getByRole("button", { name: "More" }).click();
  ok(await pg.getByRole("menuitem", { name: /Export \.lrc file/ }).isDisabled(), "Export is off until a line has a time");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(400);
  await pg.locator(".tm-play").click(); await pg.waitForTimeout(1200);
  await pg.locator(".tm-set").click(); await pg.waitForTimeout(300);
  ok((await pg.locator(".tm-cell").first().textContent()) !== "--:--.--", "Set gives the first line a time");
  await pg.locator(".tm-play").click();
  await pg.getByRole("button", { name: "More" }).click();
  ok(await pg.getByRole("menuitem", { name: /Export \.lrc file/ }).isEnabled(), "Export works once a line has a time");
  await ctx.close();
  await browser.close();
})();
