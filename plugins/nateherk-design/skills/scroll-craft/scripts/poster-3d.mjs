#!/usr/bin/env node
/**
 * scrollcraft: render the exact posters for a 3D act.
 *
 * A 3D act's poster is what reduced-motion, lite (Save-Data, slow
 * connections) and no-WebGL visitors see for the life of the page, and what
 * everyone sees until the scene's first frame. So it must be the real scene,
 * not a screenshot of something like it (approved-collection.md: "render
 * exact desktop and phone posters from the final scene"). This drives the
 * page's own ScrollCraft3D.capture() in installed Chrome at a desktop and a
 * phone viewport and writes both files.
 *
 *   node poster-3d.mjs --url http://localhost:4500 --act "#object" --out assets/
 *   node poster-3d.mjs --url ... --act "#object" --p 0.35 --out assets/
 *
 *   --url      the SERVED page (not file://; the model is fetched)
 *   --act      selector for the act (or the canvas) to capture
 *   --p        progress to capture at. Default: the canvas's
 *              data-sc-3d-poster-p, else 0. Keep it in step with what the
 *              reader sees on arrival, or the poster-to-scene crossfade jumps.
 *   --out      folder for the files. Default: assets
 *   --name     file stem. Default: poster (writes poster.webp, poster-m.webp)
 *   --dpr      pixel ratio for the desktop poster. Default 1
 *   --dpr-m    pixel ratio for the phone poster. Default 2
 *   --quality  WebP quality 0..1. Default 0.9
 *
 * Viewports: desktop 1440 by 900, phone 390 by 844 (touch, mobile). The
 * capture size is the canvas's own box at that viewport, which is what the
 * <img class="sc-stage__poster"> covers.
 *
 * Run from the build project (playwright-core resolves from the cwd, as for
 * shoot.mjs). Uses the INSTALLED Chrome.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

let chromium;
try {
  ({ chromium } = createRequire(path.join(process.cwd(), "package.json"))("playwright-core"));
} catch {
  console.error("playwright-core not found. Run this in the build project after:\n  npm i playwright-core");
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };

const URL_ = arg("--url");
const ACT = arg("--act");
const P = arg("--p") === undefined ? null : parseFloat(arg("--p"));
const OUT = path.resolve(arg("--out", "assets"));
const NAME = arg("--name", "poster");
const DPR = parseFloat(arg("--dpr", "1"));
const DPR_M = parseFloat(arg("--dpr-m", "2"));
const QUALITY = parseFloat(arg("--quality", "0.9"));

if (!URL_ || !ACT) {
  console.error('usage: node poster-3d.mjs --url <served page> --act <selector> [--p 0] [--out assets]');
  process.exit(2);
}
if (/^file:/i.test(URL_)) {
  console.error("Serve the page (node serve.mjs). file:// blocks the model fetch.");
  process.exit(2);
}

const CHROME = [
  process.env.SCROLLCRAFT_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error("No installed Chrome found. Set SCROLLCRAFT_CHROME to its path.");
  process.exit(1);
}

// Headless Chrome has no GPU by default; SwiftShader is its software WebGL.
// Recent Chrome only falls back to it when asked, so ask. The connection
// estimate is pinned to 4G because the 3D module holds its poster under lite,
// and a drifting live estimate would make the capture fail at random.
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ["--enable-unsafe-swiftshader", "--force-effective-connection-type=4G"],
});

const SHOTS = [
  { file: `${NAME}.webp`, viewport: { width: 1440, height: 900 }, dpr: DPR, mobile: false },
  { file: `${NAME}-m.webp`, viewport: { width: 390, height: 844 }, dpr: DPR_M, mobile: true },
];

let failed = false;
fs.mkdirSync(OUT, { recursive: true });
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: s.viewport, deviceScaleFactor: 1, isMobile: s.mobile, hasTouch: s.mobile,
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("html.sc-ready, .sc-ready", { timeout: 15000 });
    await page.waitForFunction(() => globalThis.ScrollCraft3D && globalThis.ScrollCraft3D.handles.length > 0, null, { timeout: 15000 });
    const res = await page.evaluate(async ({ sel, p, dpr, q }) => {
      const el = document.querySelector(sel);
      if (!el) return { error: `no element matches ${sel}` };
      const H = globalThis.ScrollCraft3D.handles.find((h) => h.scenes.some((S) => S.act === el || S.canvas === el || el.contains(S.canvas)));
      if (!H) return { error: `no data-sc-3d scene inside ${sel}` };
      const S = H.scenes.find((x) => x.act === el || x.canvas === el || el.contains(x.canvas));
      const width = S.canvas.clientWidth || innerWidth, height = S.canvas.clientHeight || innerHeight;
      const at = p === null ? (parseFloat(S.canvas.getAttribute("data-sc-3d-poster-p")) || 0) : p;
      const blob = await H.capture(el, { p: at, width, height, dpr, type: "image/webp", quality: q });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { b64: btoa(bin), type: blob.type, width, height, p: at };
    }, { sel: ACT, p: P, dpr: s.dpr, q: QUALITY });
    if (res.error) throw new Error(res.error);
    if (res.type !== "image/webp") throw new Error(`Chrome returned ${res.type}, not image/webp`);
    const file = path.join(OUT, s.file);
    fs.writeFileSync(file, Buffer.from(res.b64, "base64"));
    const px = `${Math.round(res.width * s.dpr)}x${Math.round(res.height * s.dpr)}`;
    console.log(`wrote ${file}  ${px}px at p ${res.p}  ${(fs.statSync(file).size / 1024).toFixed(1)}KB`);
  } catch (e) {
    failed = true;
    console.error(`FAILED ${s.file}: ${e.message}${errors.length ? "\n  page errors: " + errors.join("\n  ") : ""}`);
  } finally {
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
