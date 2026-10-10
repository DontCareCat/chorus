// Real-browser checks of the folder browser (a window over the page; full screen on phones), importing several songs and
// folders at once from a typed path, the include/exclude patterns, the regex library search and picking a library folder.
//   CHORUS_URL=http://localhost:18201/ TREE_DIR=/some/empty/folder node frontend/e2e/explorer-and-regex.cjs
// TREE_DIR is created and filled with small WAV files by this script.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const B = process.env.CHORUS_URL ?? "http://localhost:18201/";
const TREE = process.env.TREE_DIR;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };

const wav = (seed) => { const n = 8000 * 2, d = Buffer.alloc(44 + n * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + n * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(8000, 24); d.writeUInt32LE(16000, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) d.writeInt16LE((i * seed + seed * 13) % 3000, 44 + i * 2); return d; };
const make = (rel, seed) => { const p = path.join(TREE, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, wav(seed)); };
[["Alpha - One.wav", 21], ["Beta - Two (live).wav", 22], ["Gamma - Three.wav", 23], ["sub/Delta - Four.wav", 24], ["sub/Epsilon - Five (live).wav", 25], ["sub/deep/Zeta - Six.wav", 26], ["other/Eta - Seven.wav", 27]].forEach(([r, s]) => make(r, s));
fs.writeFileSync(path.join(TREE, "readme.txt"), "not audio");

/** Click Import and read the server's answer (exact numbers, whatever the page shows). */
const importNow = async (page) => { const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/library/import-many")), page.click('button:has-text("Import selected")')]); return res.status() === 200 ? res.json() : { status: res.status(), ...(await res.json()) }; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  if (process.env.DEBUG) page.on("request", (r) => r.url().includes("import-many") && console.log("   REQUEST", r.postData()));
  const titles = async () => (await page.$$eval(".song-title", (e) => e.map((x) => x.textContent))).sort();

  console.log("[the window]");
  await page.goto(B); await page.waitForSelector(".song");
  await page.click('button:has-text("Add music")');
  await page.click('.add-panel button:has-text("Browse")');
  await page.waitForSelector('[role="dialog"]');
  const box = await page.$eval(".dialog", (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left }; });
  ok(box.w <= 760 && box.left > 100 && (await page.isVisible(".song-title >> nth=0")), `a window over the page on a PC (${Math.round(box.w)} px wide); the library is still there behind it`);
  ok(await page.$eval(".dialog-scrim", (e) => getComputedStyle(e).position === "fixed"), "with a scrim over the page");

  console.log("[typing a custom path, walking around]");
  await page.fill('.path-bar input', TREE); await page.press('.path-bar input', "Enter");
  await page.waitForSelector(`.fs-list li:has-text("Alpha - One.wav")`);
  const names = await page.$$eval(".fs-list li", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(names[0].startsWith("deep") === false && names.slice(0, 2).every((n) => !/\.wav/.test(n)), "folders come first: " + names.slice(0, 3).join(" | "));
  ok(!names.some((n) => n.includes("readme.txt")), "files that are not audio are not listed");
  await page.click('button[aria-label="Open sub"]'); await page.waitForSelector('.fs-list li:has-text("Delta - Four.wav")');
  ok((await page.$$eval(".crumbs button", (e) => e.at(-1).textContent)) === "sub", "the breadcrumbs follow: " + (await page.$$eval(".crumbs button", (e) => e.map((x) => x.textContent))).slice(-2).join(" › "));
  await page.click('button[aria-label="Up one folder"]'); await page.waitForSelector('.fs-list li:has-text("Alpha - One.wav")');
  ok((await page.$$eval('.path-bar select option', (o) => o.map((x) => x.textContent))).includes("Home"), "the Places menu offers Home");
  await page.fill('.path-bar input', path.join(TREE, "nowhere")); await page.press('.path-bar input', "Enter");
  await page.waitForSelector('.dialog .notice.error');
  ok(/does not exist/.test(await page.textContent(".dialog .notice.error")), "a path that does not exist is explained: " + (await page.textContent(".dialog .notice.error")).slice(0, 60));
  await page.fill('.path-bar input', TREE); await page.press('.path-bar input', "Enter");
  await page.waitForSelector('.fs-list li:has-text("Alpha - One.wav")');

  console.log("[importing several things at once]");
  await page.check('input[aria-label="Select Alpha - One.wav"]');
  await page.check('input[aria-label="Select Gamma - Three.wav"]');
  await page.check('input[aria-label="Select other"]');
  ok(/2 songs and 1 folder selected/.test(await page.textContent(".fs-actions")), "the footer counts the choice: " + (await page.textContent(".fs-actions")).trim().slice(0, 40));
  let r = await importNow(page);
  ok(r.added === 3 && r.errors.length === 0, "two songs and a folder arrive together: " + JSON.stringify(r));
  await page.waitForSelector(".notice.ok");
  ok(/3 added/.test(await page.textContent(".notice.ok")), "and the page says so: " + (await page.textContent(".notice.ok")));
  ok(!(await page.isVisible('[role="dialog"]')), "the window closes");
  ok((await titles()).join("|").includes("One") && (await titles()).some((t) => t.includes("Seven")), "they are in the library");

  console.log("[filters: regular expressions on file names]");
  await page.click('.add-panel button:has-text("Browse")');
  await page.fill('.path-bar input', TREE); await page.press('.path-bar input', "Enter");
  await page.waitForSelector('.fs-list li:has-text("Alpha - One.wav")');
  await page.check('input[aria-label="Select sub"]');
  await page.click('summary:has-text("Only some files")');
  await page.getByLabel("Only names that match").fill("\\(live\\)");
  r = await importNow(page);
  ok(r.added === 1 && r.filtered === 2, "only the (live) file of the folder is taken: " + JSON.stringify(r));
  await page.click('.add-panel button:has-text("Browse")');
  await page.fill('.path-bar input', TREE); await page.press('.path-bar input', "Enter");
  await page.waitForSelector('.fs-list li:has-text("Alpha - One.wav")');
  await page.check('input[aria-label="Select sub"]');
  await page.click('summary:has-text("Only some files")');
  await page.getByLabel("Only names that match").fill("(");
  r = await importNow(page);
  ok(r.status === 422 && r.error.code === "invalid_pattern", "a broken pattern is refused by the server before anything is imported");
  await page.waitForSelector(".dialog .notice.error");
  ok(/not a valid regular expression/.test(await page.textContent(".dialog .notice.error")) && (await page.isVisible('[role="dialog"]')), "a broken pattern is explained and the window stays open");
  await page.getByLabel("Only names that match").fill(""); await page.getByLabel("Leave out names that match").fill("five|six");
  r = await importNow(page);
  ok(r.added === 1 && r.filtered === 2, "leaving out names works too: " + JSON.stringify(r));

  console.log("[regular expression search in the library]");
  await page.reload(); await page.waitForSelector(".song");
  const total = (await titles()).length;
  await page.fill('.search-box input', "^(one|two)"); // plain text: "^(one|two)" is not found
  ok((await titles()).length === 0, "plain search takes the text literally");
  await page.click('.regex-toggle');
  ok((await titles()).join("|").match(/One|Two/g) && (await titles()).length === 1, "with the regex toggle on the pattern works: " + (await titles()).join(", "));
  await page.fill('.search-box input', "(live|seven)$|^Delta");
  ok((await titles()).length >= 2, "alternatives and anchors: " + (await titles()).join(", "));
  await page.fill('.search-box input', "(");
  await page.waitForSelector('.notice.error[role="status"]');
  ok((await titles()).length === total, "an invalid pattern explains itself and leaves the list alone");

  console.log("[picking a library folder in Settings]");
  await page.goto(B + "#/settings"); await page.waitForSelector("text=Save settings");
  await page.click('button:has-text("Browse")');
  await page.fill('.path-bar input', path.join(TREE, "other")); await page.press('.path-bar input', "Enter");
  await page.waitForSelector('.fs-list li:has-text("Eta - Seven.wav")');
  ok((await page.$$('.dialog input[type="checkbox"]')).length === 1, "folder mode has no song checkboxes (only 'show hidden')");
  await page.click('button:has-text("Use this folder")');
  ok((await page.$$eval(".folder-list li span", (e) => e.map((x) => x.textContent))).some((t) => t.endsWith("other")), "the chosen folder is in the list");

  console.log("[phone: the window fills the screen]");
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(B); await m.waitForSelector(".song");
  await m.click(".menu-btn").catch(() => {}); await m.click(".menu-btn").catch(() => {});
  await m.click('button:has-text("Add music")'); await m.click('.add-panel button:has-text("Browse")');
  await m.waitForSelector('[role="dialog"]');
  const d = await m.$eval(".dialog", (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: r.top }; });
  ok(d.w === 390 && d.h === 844 && d.top === 0, `the window is the whole screen (${d.w}x${d.h})`);
  const foot = await m.$eval(".fs-actions .btn:last-child", (e) => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.height >= 44; });
  ok(foot, "the Import button is on screen and at least 44 px tall");
  await browser.close();
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL EXPLORER AND REGEX CHECKS PASSED");
})();
