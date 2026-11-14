// beta.26 redesign: song item (one tag style, status tag + bubble, length column), the bottom fade under the queue bar, the Add music
// menu (sheet / popover with exit animation) and the Settings page. Isolated stack: backend :18211 (own data dir) with fake-lrclib.py on :18212.
//   CHORUS_URL=http://localhost:18211/ node frontend/e2e/redesign26.cjs
const { chromium } = require("playwright");
const B = process.env.CHORUS_URL ?? "http://localhost:18211/";
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const wav = (secs, seed) => { const n = 8000 * secs, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed) % 3000, 44 + i * 2); return d; };
const lrc = ["[00:00.50] Eins zwei drei", "[00:20.00] Vier fünf sechs", "[00:40.00] Sieben acht neun"].join("\n");

(async () => {
  const browser = await chromium.launch();
  for (const [label, viewport, phone] of [["phone 390x844", { width: 390, height: 844 }, true], ["PC 1280", { width: 1280, height: 800 }, false]]) {
    console.log(`[${label}]`);
    const ctx = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    if (phone === true) {
      const add = async (name, seed, secs) => (await (await page.request.post(B + "api/songs", { multipart: { file: { name, mimeType: "audio/wav", buffer: wav(secs, seed) } } })).json());
      const a = await add("Band - Testlied.wav", 41, 60), b = await add("Nobody - Silent.wav", 42, 75);
      await page.request.put(B + `api/songs/${b.id}`, { data: { language: "fr" } });
      await page.waitForTimeout(2500);
    }
    if (phone === true) await page.request.post(B + "api/auth/register", { data: { username: "yeye", password: "correct horse", display_name: "Ye" } }); // the first account administers the server
    else await page.request.post(B + "api/auth/login", { data: { username: "yeye", password: "correct horse" } });
    await page.goto(B); await page.waitForSelector(".song");

    // ---- song item
    const rows = await page.$$eval(".song-main", (els) => els.map((e) => {
      const tags = [...e.querySelectorAll(".tag")].map((t) => { const cs = getComputedStyle(t); return { text: t.textContent.trim(), fs: cs.fontSize, fw: cs.fontWeight, h: t.getBoundingClientRect().height, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, ls: cs.letterSpacing, tt: cs.textTransform, bg: cs.backgroundColor }; });
      const len = e.querySelector(".song-length"), k = e.querySelector(".kebab").getBoundingClientRect(), r = e.getBoundingClientRect();
      return { tags, len: len?.textContent.trim(), lenRight: len?.getBoundingClientRect().right, kebabLeft: k.left, kids: [...e.children].map((c) => c.className.split(" ")[0]), title: getComputedStyle(e.querySelector(".song-title")).fontSize, cover: e.querySelector(".cover").getBoundingClientRect().width };
    }));
    const allTags = rows.flatMap((r) => r.tags);
    ok(allTags.length >= 3, "tags are drawn: " + allTags.map((t) => t.text).join(", "));
    const sig = (t) => [t.fs, t.fw, t.h, t.radius, t.border, t.ls, t.tt, t.bg].join("|");
    ok(new Set(allTags.map(sig)).size === 1, "every tag (language, status) has the same style: " + [...new Set(allTags.map(sig))].join(" || "));
    ok(allTags[0].fs === "12px" && allTags[0].h === 20 && allTags[0].border === "1px" && allTags[0].radius === "5px" && allTags[0].tt === "uppercase", "the tag is 12px uppercase, 20px high, 1px border, radius 5");
    ok(rows.some((r) => r.len === "1:00") && rows.some((r) => r.len === "1:15"), "the length column shows 1:00 and 1:15: " + rows.map((r) => r.len).join(", "));
    ok(rows.every((r) => r.title === "17px"), "title 17px");
    ok(rows.every((r) => !r.kids.includes("status-cell")), "no status slot column");
    ok(phone ? rows.every((r) => r.cover === 56) : rows.every((r) => r.cover === 88 || r.cover === 80), "cover size " + rows[0].cover);
    ok(rows.every((r) => Math.abs(r.lenRight - rows[0].lenRight) < 1), "the length column lines up in every row");
    ok(await page.$(".yt-tag, .dup-tag, .status-slot, .yt-unplayable") === null, "old yt-tag / dup-tag / status-slot are gone");

    // ---- status tag + bubble
    const st = page.locator(".status-tag").first();
    ok((await st.count()) >= 1, "a song without lyrics has a status tag: " + (await st.textContent()));
    await st.click();
    await page.waitForSelector(".status-bubble");
    const g = await page.evaluate(() => { const t = document.querySelector(".status-tag").getBoundingClientRect(), b = document.querySelector(".status-bubble").getBoundingClientRect(); return { tagTop: t.top, tagBottom: t.bottom, bubTop: b.top, bubBottom: b.bottom, bubW: b.width, bg: getComputedStyle(document.querySelector(".status-tag")).backgroundColor, text: getComputedStyle(document.querySelector(".status-tag")).color, bodyBg: getComputedStyle(document.body).backgroundColor, fix: !!document.querySelector(".status-bubble .btn") }; });
    ok(phone ? g.bubBottom <= g.tagTop : g.bubTop >= g.tagBottom, `bubble is ${phone ? "above" : "under"} the tag`);
    ok(phone ? g.bubW === 288 : g.bubW > 0, "bubble width " + g.bubW);
    ok(g.text === g.bodyBg && g.bg !== g.bodyBg, "the open tag is inverse (" + g.bg + " on " + g.text + ")");
    ok(g.fix, "the bubble has the fix button");
    await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    ok((await page.$(".status-bubble")) === null, "Esc closes the bubble");
    await st.click(); await page.waitForSelector(".status-bubble"); await page.mouse.click(viewport.width / 2, 5); await page.waitForTimeout(100);
    ok((await page.$(".status-bubble")) === null, "a tap outside closes it");

    // ---- add to queue and the fade
    if (phone) {
      const kebab = page.locator(".kebab").first();
      await kebab.click(); await page.getByRole("menuitem", { name: /queue/i }).first().click(); await page.waitForSelector(".queue-bar");
      await page.waitForTimeout(500);
      const f = await page.evaluate(() => {
        const q = document.querySelector(".queue-bar").getBoundingClientRect(), fade = document.querySelector(".nav-fade"), fr = fade.getBoundingClientRect(), nav = document.querySelector(".main-nav").getBoundingClientRect();
        const hit = (x, y) => document.elementFromPoint(x, y);
        const z = (e) => parseInt(getComputedStyle(e).zIndex);
        return { qTop: q.top, qBottom: q.bottom, fadeTop: fr.top, fadeBottom: fr.bottom, navTop: nav.top, atTop: !!hit(q.left + q.width / 2, q.top + 2)?.closest(".queue-bar"), atMid: !!hit(q.left + q.width / 2, q.top + q.height / 2)?.closest(".queue-bar"), zFade: z(fade), zQ: z(document.querySelector(".queue-bar")), zNav: z(document.querySelector(".main-nav")), pe: getComputedStyle(fade).pointerEvents, bg: getComputedStyle(fade).backgroundImage };
      });
      ok(f.atTop && f.atMid, "elementFromPoint at the queue bar's top edge and middle returns the queue bar");
      ok(f.zFade < f.zQ && f.zQ < f.zNav, `stacking fade ${f.zFade} < queue bar ${f.zQ} < tabs ${f.zNav}`);
      console.log("   ", JSON.stringify(f));
      ok(Math.abs(f.qTop - f.fadeTop - 48) <= 1, `the fade starts 48px above the queue bar: ${f.qTop - f.fadeTop}`);
      ok(Math.abs(f.fadeBottom - (await page.evaluate(() => innerHeight))) <= 1 && f.pe === "none", "it runs to the bottom of the screen (behind the tabs) and never takes a tap");
      await page.screenshot({ path: process.env.SHOTS + "/fade-queue-phone.png" }).catch(() => undefined);
    }

    // ---- Add music
    const btn = page.locator(".page-head .add-anchor .btn");
    await btn.click();
    if (phone) {
      await page.waitForSelector(".sheet.add-sheet");
      ok((await page.textContent(".sheet-head")).includes("Songs go to your library. Lyrics are looked up by themselves."), "sheet head and help line");
      const items = await page.$$eval(".add-sheet .mi", (e) => e.map((x) => ({ t: x.textContent.trim(), h: x.getBoundingClientRect().height })));
      ok(items.length >= 5 && items.every((i) => i.h === 52), "52px rows: " + items.map((i) => i.t).join(" | "));
      await page.getByRole("menuitem", { name: /Paste a YouTube link/ }).click();
      await page.waitForSelector(".am-step");
      ok(await page.getByLabel("Video or playlist link").count() === 1, "second step has the labelled input");
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByRole("menuitem", { name: /Import from a folder path/ }).click();
      ok(await page.getByLabel("Import by path").count() === 1 && await page.getByRole("button", { name: "Import" }).count() >= 1, "folder step has the path field and Import");
      await page.mouse.click(viewport.width / 2, 40); await page.waitForTimeout(500);
      ok((await page.$(".sheet")) === null, "tapping the scrim rolls the sheet away");
    } else {
      await page.waitForSelector(".add-popover");
      await page.waitForTimeout(250);
      const p = await page.evaluate(() => { const e = document.querySelector(".add-popover"), r = e.getBoundingClientRect(), b = document.querySelector(".add-anchor .btn").getBoundingClientRect(); return { w: r.width, right: r.right, bRight: b.right, top: r.top, bBottom: b.bottom, state: e.dataset.state, op: getComputedStyle(e).opacity, cls: document.querySelector(".add-anchor .btn").className, mi: [...e.querySelectorAll(".mi")].map((x) => x.getBoundingClientRect().height), foot: e.querySelector(".add-foot")?.textContent }; });
      ok(p.w === 300 && Math.abs(p.right - p.bRight) <= 1 && p.top >= p.bBottom, `popover 300px, right-aligned under the button (w ${p.w})`);
      ok(p.state === "open" && p.op === "1" && /inverse/.test(p.cls), "open state, button inverse");
      ok(p.mi.every((h) => h === 44) && p.foot === "Or drop files anywhere on this page.", "44px rows and the drop hint");
      await page.getByRole("menuitem", { name: /Paste a YouTube link/ }).click();
      await page.waitForTimeout(300);
      ok((await page.evaluate(() => document.querySelector(".add-popover").getBoundingClientRect().width)) === 400, "second step is 400px wide");
      await page.keyboard.press("Escape");
      const during = await page.evaluate(() => { const e = document.querySelector(".add-popover"); return e ? e.dataset.state : "gone"; });
      ok(during === "closed", "right after closing it is still mounted, fading out: " + during);
      await page.waitForTimeout(350);
      ok((await page.$(".add-popover")) === null, "and gone after the exit transition");
    }
    ok((await page.locator(".add-panel, .add-tabs").count()) === 0, "no inline add panel or tabs");

    // ---- Settings
    await page.goto(B + "#/settings"); await page.waitForSelector(".scard");
    const ids = await page.$$eval(".scard", (e) => e.map((x) => x.dataset.section));
    ok(JSON.stringify(ids.slice(0, 4)) === JSON.stringify(["account", "appearance", "lyrics", "playing"]), "section order: " + ids.join(" > "));
    const firstRow = await page.textContent("#settings-lyrics .srow");
    ok(/Lyrics service/.test(firstRow) && /LRCLIB-compatible/.test(firstRow), "Lyrics service is the first row of Lyrics");
    ok((await page.$(".save-bar")) === null, "no page-wide save bar");
    const sv = page.getByRole("button", { name: "Save", exact: true }).first();
    ok(await sv.isDisabled(), "the service Save is disabled before an edit");
    await page.getByLabel("Lyrics service").fill("http://127.0.0.1:18212/api/");
    ok(await sv.isEnabled(), "and enabled after one");
    await sv.click();
    await page.waitForSelector("text=Connected");
    ok(true, "Save checked the server and shows Connected");
    ok((await page.inputValue('input[aria-label="Lyrics service"]')) === "http://127.0.0.1:18212/api", "the address was tidied");
    const sw = page.getByRole("switch", { name: "Pick the closest match by itself" });
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    await page.waitForSelector(".float-toast");
    ok((await page.textContent(".float-toast")).includes("Saved"), "a switch shows the floating Saved");
    const server = async () => (await page.request.get(B + "api/settings")).json();
    const until = async (f) => { for (let i = 0; i < 30; i++) { if (f(await server())) return true; await page.waitForTimeout(100); } return false; };
    ok(await until((s) => s.auto_pick_closest === (before !== "true")), "and was saved on the server");
    const mins = (await server()).lyrics_timeout_minutes;
    await page.getByRole("button", { name: "Warn when not found after: More" }).click();
    ok(await until((s) => s.lyrics_timeout_minutes > mins), "the stepper saved a longer time (" + mins + " min before)");
    await sw.click(); await page.waitForTimeout(300); // back as it was
    const nav = await page.$$eval(".snav .snav-item, .snav .chip", (e) => e.map((x) => x.textContent.trim()));
    ok(nav.length >= 7, (phone ? "chip row" : "section index") + ": " + nav.join(", "));
    await page.click('.snav [data-section="library"]'); await page.waitForTimeout(900);
    const cur = await page.$eval('.snav [aria-current="true"]', (e) => e.dataset.section);
    ok(cur === "library" || cur === "server" || cur === "about", "jumping lights the section: " + cur);
    const geo = await page.evaluate(() => ({ w: document.querySelector(".settings-body").getBoundingClientRect().width, over: document.documentElement.scrollWidth - innerWidth, rows: [...document.querySelectorAll(".srow")].every((r) => { const cs = getComputedStyle(r); return parseFloat(cs.paddingTop) === 14 && parseFloat(cs.paddingLeft) === 16; }) }));
    ok(geo.over <= 0, "no horizontal overflow");
    ok(phone || geo.w <= 761, "content is at most ~760px: " + geo.w);
    ok(geo.rows, "rows are padded 14px 16px");
    await page.screenshot({ path: `${process.env.SHOTS}/settings-${phone ? "phone" : "pc"}.png`, fullPage: false }).catch(() => undefined);
    await ctx.close();
  }
  await browser.close();
})();
