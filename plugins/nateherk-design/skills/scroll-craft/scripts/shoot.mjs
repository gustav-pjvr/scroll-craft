#!/usr/bin/env node
/**
 * scrollcraft verification harness: shoot the page's own scroll.
 *
 * Walks the page in N evenly spaced scroll positions, waits for the scrub video
 * to actually settle at each one, screenshots it, and reports what the engine
 * thinks is on screen. Then tiles the frames into one contact sheet, because a
 * dead middle only shows up in contiguous frames: any single screenshot is a
 * frame the transition may not survive.
 *
 *   node shoot.mjs --url http://localhost:4500 --out lab/shots --steps 12
 *   node shoot.mjs --url ... --width 375 --height 812 --out lab/mobile
 *   node shoot.mjs --url ... --reduced-motion --out lab/reduced
 *   node shoot.mjs --url ... --lite --out lab/lite
 *   node shoot.mjs --url ... --section "#story" --out lab/section
 *
 * --lite installs a fake navigator.connection (Save-Data on, effectiveType
 * 2g) before the page loads, so the engine's media mode resolves to lite:
 * clips and sequences are never fetched and posters hold. Like
 * --reduced-motion it skips the frozen-clip check, and it reports whether the
 * engine honoured the override (api.media, the sc-lite class, and any clip
 * request seen during the walk). The fake is window.__scConnection: a real
 * EventTarget, so a test can change saveData or effectiveType and dispatch
 * a 'change' event on it.
 *
 * --section <selector> verifies one section-mode mount on a host page: it
 * waits for .sc-ready on that element instead of on <html>, and discovers
 * acts, cues, clips and the rest only inside it.
 *
 * Uses the INSTALLED Chrome, not bundled Chromium: Chromium ships without the
 * h264 decoder, so every scrub clip would silently fail to paint and the run
 * would "pass" against posters.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { underChrome } from "./lib/under-chrome.mjs";

// The skill lives outside the project it is building, so resolve playwright
// from the BUILD project's node_modules (cwd), not from next to this file.
// Run `npm i playwright-core` in the build project once.
let chromium;
try {
  ({ chromium } = createRequire(path.join(process.cwd(), "package.json"))("playwright-core"));
} catch {
  console.error("playwright-core not found. Run this in the build project after:\n  npm i playwright-core");
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const URL = arg("--url", "http://localhost:4500");
const OUT = path.resolve(arg("--out", "lab/shots"));
const STEPS = parseInt(arg("--per-act", arg("--steps", "6")), 10);  // samples PER ACT
const W = parseInt(arg("--width", "1440"), 10);
const H = parseInt(arg("--height", "900"), 10);
const REDUCED = has("--reduced-motion");
const LITE = has("--lite");
const SECTION = arg("--section", null);
if (has("--section") && (!SECTION || SECTION.startsWith("--"))) {
  console.error("--section needs a selector, e.g. --section \"#story\"");
  process.exit(1);
}
// Clips deliberately never fetched: reduced motion by the reader's choice,
// lite by the connection. Every check that expects a painted clip stands down.
const HOLD = REDUCED || LITE;

const CHROME = [
  process.env.SCROLLCRAFT_CHROME,
  // Windows
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  // Linux
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

fs.mkdirSync(OUT, { recursive: true });

// Pin Chrome's own connection estimate to 4G. The engine holds clips on their
// posters when navigator.connection reads slow, and on a high-latency line
// Chrome's live estimate drifts to "3g" mid-run (measured 600 to 750 ms RTT on
// a 1.75 Mbps line), which silently turns an ordinary run into a lite one.
// --lite still installs its own slow connection on top of this.
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--force-effective-connection-type=4G"] });
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  reducedMotion: REDUCED ? "reduce" : "no-preference",
});

// Headless Chrome can still reach desktop-wide cursor APIs on Windows.
// Install before navigation; synthetic in-page movement needs no native lock.
await page.addInitScript(() => {
  Element.prototype.requestPointerLock = function () {
    return Promise.reject(new Error("Native pointer lock disabled during verification"));
  };
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
  Document.prototype.exitPointerLock = function () {};
});

// Lite: a connection the engine must treat as slow. A real EventTarget so a
// test can flip the values and dispatch 'change'; defined on the navigator
// instance, which shadows Chrome's own prototype getter.
if (LITE) {
  await page.addInitScript(() => {
    class SCConnection extends EventTarget {
      constructor() {
        super();
        this.saveData = true;
        this.effectiveType = "2g";
        this.downlink = 0.2;
        this.rtt = 1800;
        this.onchange = null;
      }
    }
    const conn = new SCConnection();
    Object.defineProperty(navigator, "connection", { configurable: true, value: conn });
    window.__scConnection = conn;
  });
}
// Section: every page-side query below reads this to scope itself to the mount.
if (SECTION) await page.addInitScript((sel) => { window.__scShotScope = sel; }, SECTION);
const liteClipRequests = [];
if (LITE) page.on("request", (r) => { if (/\.(mp4|webm)(\?|$)/i.test(r.url())) liteClipRequests.push(r.url()); });

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const failed = [];
page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));

// Not networkidle: the engine keeps clips in flight as you scroll, and a
// webfont connection can stay open, so idle may never arrive. Wait for the
// engine's own ready signal and for the faces to land, since line splitting
// measures real line boxes and is wrong before the real face is applied.
await page.goto(URL, { waitUntil: "domcontentloaded" });
// Page mode marks <html>, section mode marks the mount root (DESIGN.md N1), so
// the default waits for either. --section waits for its own element only.
await waitReady();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);

async function waitReady() {
  if (!SECTION) {
    await page.waitForSelector("html.sc-ready, .sc-ready", { timeout: 15000 });
    return;
  }
  try {
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      return !!el && el.classList.contains("sc-ready");
    }, SECTION, { timeout: 15000 });
  } catch {
    const why = await page.evaluate((sel) => ({
      found: !!document.querySelector(sel),
      html: document.documentElement.classList.contains("sc-ready"),
    }), SECTION);
    console.error(!why.found ? `--section ${SECTION}: no element matches that selector`
      : why.html ? `--section ${SECTION}: the engine marked <html> sc-ready, not the section. ` +
        "The engine predates section mode, or the root was mounted in page mode."
      : `--section ${SECTION}: never became .sc-ready within 15s`);
    await browser.close();
    process.exit(1);
  }
}

const doc = await page.evaluate(() => {
  const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
  const world = R.querySelector('[data-sc-mode="worldflight"]');
  return {
    height: document.body.scrollHeight,
    vh: innerHeight,
    acts: [...R.querySelectorAll("[data-sc-act]")].map((a) => a.dataset.scAct),
    world: world
      ? {
          seam: parseFloat(world.dataset.scSeam) || 0.12,
          segs: [...world.querySelectorAll("[data-sc-segment]")].map((s) => ({
            w: parseFloat(s.dataset.scW) || 1.3,
            linger: parseFloat(s.dataset.scLinger) || 0,
            label: s.dataset.scWaypoint || "",
          })),
        }
      : null,
  };
});
const WORLD = doc.world;
const maxScroll = doc.height - doc.vh;

if (WORLD) {
  const total = WORLD.segs.reduce((s, g) => s + g.w, 0);
  console.log(`page: worldflight, ${WORLD.segs.length} legs over ${total.toFixed(2)}vh ` +
    `(track ${(doc.height / doc.vh).toFixed(1)} viewport-heights), seam ${WORLD.seam}vh`);
  console.log(`  legs: ${WORLD.segs.map((g, i) => `${i}:${g.label || "-"}@${g.w}vh`).join("  ")}`);
} else {
  console.log(`page: ${(doc.height / doc.vh).toFixed(1)} viewport-heights, acts: ${doc.acts.join(" > ")}`);
}

// Wait for the playhead to ARRIVE, not merely to stop seeking. The engine lerps
// currentTime toward a target on its own rAF loop, so after any scroll jump
// there is a stretch of ~15 frames during which every clip on the page is
// somewhere it will never be again. Screenshot in that window and the sheet is a
// set of frames the reader is never shown, the dead-scroll comparison runs on
// mid-lerp noise, and the whole run is unrepeatable.
async function settle(timeout = 4000) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    const now = await page.evaluate(() => {
      const insts = (window.ScrollCraft && window.ScrollCraft.instances) || [];
      const clips = [].concat(...insts.map((i) => i.clips || [])).filter((c) => c.ready);
      // Pages on an older engine expose no instances; fall back to watching
      // currentTime go quiet, which reaches the same state more slowly.
      if (clips.length) {
        const arrived = clips.every((c) => Math.abs(c.cur - c.target) < 0.002 && !c.el.seeking);
        return arrived ? "arrived" : "moving";
      }
      return [...document.querySelectorAll("video[data-sc-scrub]")]
        .map((v) => (v.seeking ? "seeking" : v.currentTime.toFixed(3))).join("|");
    });
    if (now === "arrived") return true;
    if (now !== "moving" && now === last && !now.includes("seeking")) return true;
    if (Date.now() - t0 > timeout) return false;
    last = now;
    await page.waitForTimeout(60);
  }
}

// Sample WITHIN each act, not uniformly down the document. Uniform sampling
// distributes positions by page length, so a short act gets one sample that
// lands wherever it lands, and adding a section elsewhere silently moves every
// sample. That produces "this cue never reaches full opacity" reports that come
// and go with unrelated edits. Per-act sampling hits the same fractions of
// every act every run, so the findings mean something.
//
// A worldflight has no acts to sample within; its unit is the leg, and its
// geometry lives entirely in the weights, so positions are computed from the
// track rather than measured off the DOM. Both sides of every seam are added on
// top: the crossfade is the frame this mode is judged on, and it occupies about
// a tenth of a viewport, so uniform sampling steps straight over it.
const positions = WORLD ? await page.evaluate((perSeg) => {
  const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
  const root = R.querySelector('[data-sc-mode="worldflight"]');
  const segs = [...root.querySelectorAll("[data-sc-segment]")];
  const top = root.getBoundingClientRect().top + scrollY;
  const seam = parseFloat(root.dataset.scSeam) || 0.12;
  const fracs = Array.from({ length: perSeg }, (_, i) => (perSeg === 1 ? 0.5 : i / (perSeg - 1)));
  const out = [];
  let c = 0;
  segs.forEach((s, i) => {
    const w = parseFloat(s.dataset.scW) || 1.3;
    fracs.forEach((f) => {
      const p = 0.02 + f * 0.96;
      out.push(Math.round(top + (c + w * p) * innerHeight));
    });
    c += w;
    if (i < segs.length - 1) {
      [-0.5, -0.2, 0.2, 0.5].forEach((k) => out.push(Math.round(top + (c + k * seam) * innerHeight)));
    }
  });
  const max = document.body.scrollHeight - innerHeight;
  out.push(0, max);
  return [...new Set(out.map((y) => Math.max(0, Math.min(max, y))))].sort((a, b) => a - b);
}, Math.max(2, Math.round(STEPS))) : await page.evaluate((perAct) => {
  const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
  const out = [];
  const fracs = Array.from({ length: perAct }, (_, i) => (perAct === 1 ? 0.5 : i / (perAct - 1)));
  R.querySelectorAll("[data-sc-act]").forEach((el) => {
    const top = el.getBoundingClientRect().top + scrollY;
    const h = el.offsetHeight;
    const pinned = ["scrub", "pin", "pan"].includes(el.dataset.scAct);
    fracs.forEach((f) => {
      // Nudge off the exact endpoints: p=0 and p=1 sit on the seam between two
      // acts, where which one you are "in" is ambiguous.
      const p = 0.02 + f * 0.96;
      out.push(Math.round(pinned ? top + (h - innerHeight) * p : top - innerHeight + (h + innerHeight) * p));
    });
    // A pinned stage is on screen for a viewport BEFORE its pinned travel begins
    // and a viewport AFTER it ends, and the loop above samples only inside the
    // travel. Those two slides are exactly where a clip mapped to pinned
    // progress sits frozen on its first or last frame, so not sampling them is
    // why a frozen clip could pass this harness. Sample them.
    if (el.dataset.scAct === "scrub") {
      // `v` is the fraction of the viewport the stage covers at that position.
      // Sample the part of each slide where the stage is still MOSTLY on screen,
      // because that is where a frozen frame is conspicuous, and because the
      // frozen-clip check needs consecutive samples that are both well past its
      // visibility gate before it will call anything.
      [0.6, 0.75, 0.9].forEach((v) => {
        out.push(Math.round(top - innerHeight * (1 - v)));  // sliding in
        out.push(Math.round(top + h - innerHeight * v));    // sliding out
      });
    }
  });
  const max = document.body.scrollHeight - innerHeight;
  // A section's walk ends where the section's last viewport ends, not at the
  // host page's footer.
  if (R !== document) {
    const b = R.getBoundingClientRect();
    out.push(Math.round(b.bottom + scrollY - innerHeight));
  } else out.push(max);
  return [...new Set(out.map((y) => Math.max(0, Math.min(max, y))))].sort((a, b) => a - b);
}, Math.max(2, Math.round(STEPS)));

// The first screen, before any scroll: nothing has scrolled under the header
// yet, so ANY visible text overlapped by fixed or sticky chrome is a defect
// (the eyebrow clipped under a fixed bar is the case this exists for).
await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(300);
const firstChrome = await page.evaluate(underChrome, { all: true, scope: SECTION });

const report = [];
for (let i = 0; i < positions.length; i++) {
  const y = positions[i];
  const p = maxScroll ? y / maxScroll : 0;
  await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y);
  await page.waitForTimeout(180);
  const settled = await settle();

  const state = await page.evaluate(() => {
    const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
    // A kinetic heading carries its real opacity on the split line units; the
    // engine forces the element itself to 1. Reading the element therefore
    // reports every kinetic headline as fully present, including on frames
    // where every one of its lines is at 0. Take the strongest line instead:
    // the heading is "peaked" when at least one unit has arrived.
    const cueOpacity = (el) => {
      const o = parseFloat(getComputedStyle(el).opacity) || 0;
      const units = el.querySelectorAll(".sc-split__i");
      if (!units.length) return o;
      let m = 0;
      units.forEach((u) => { m = Math.max(m, parseFloat(getComputedStyle(u).opacity) || 0); });
      return o * m;
    };
    const vis = [];
    // A worldflight's copy blocks are windowed against the whole track rather
    // than an act's progress, but they are the same thing to a reader: type that
    // has to arrive, hold, and leave. Grade them identically.
    R.querySelectorAll("[data-sc-cue],[data-sc-copy]").forEach((el) => {
      const o = cueOpacity(el);
      if (o <= 0.02) return;
      // On screen, not merely non-transparent. An element parked off-viewport
      // at opacity 1 is not a visible cue, and counting it produces phantom
      // findings that send you chasing a bug the reader never sees.
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      vis.push({ t: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 46), o: +o.toFixed(2) });
    });
    const clips = [...R.querySelectorAll("video[data-sc-scrub]")].map((v) => ({
      // A continuous world legitimately keeps its clip chain outside the act
      // stack, driven by the page's own scroll value rather than by an act's
      // progress. Falling back to the clip's own class keeps that case
      // reporting instead of taking the whole run down before it writes
      // anything.
      painted: (v.closest("[data-sc-act]") ?? v).classList.contains("sc-has-clip"),
      t: +(v.currentTime || 0).toFixed(2),
      dur: +(v.duration || 0).toFixed(2),
      // How much of the viewport this clip's stage actually covers. A frozen
      // playhead only matters while the reader can see the stage.
      vis: (() => {
        const st = v.closest("[data-sc-stage]") || v.parentElement;
        if (!st) return 0;
        const b = st.getBoundingClientRect();
        return +(Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0)) / innerHeight).toFixed(3);
      })(),
    }));
    // Rails and wipes move without changing any cue or clip time, so without
    // these a panning section reads as dead scroll.
    const rails = [...R.querySelectorAll("[data-sc-pan]")]
      .map((r) => Math.round(new DOMMatrixReadOnly(getComputedStyle(r).transform).m41));
    const wipes = [...R.querySelectorAll("[data-sc-reveal]")]
      .map((r) => getComputedStyle(r).clipPath);
    // Which act owns the middle of the viewport right now.
    let act = "-";
    R.querySelectorAll("[data-sc-act]").forEach((a) => {
      const r = a.getBoundingClientRect();
      if (r.top <= innerHeight / 2 && r.bottom >= innerHeight / 2) act = a.dataset.scAct;
    });
    // Where each pinned stage physically sits. Before an act reaches its pin
    // point the stage slides up the screen while its progress is still clamped
    // to 0, so the clip and cues are frozen and yet the view is very much
    // moving. Without this the run-up to every pinned act reads as dead scroll.
    const stages = [...R.querySelectorAll("[data-sc-stage]")]
      .map((s) => Math.round(s.getBoundingClientRect().top));
    // Worldflight legs. Opacity IS the crossfade, so it is state, not styling:
    // two samples with the same clip times but different leg opacities are a
    // dissolve in progress, not dead scroll.
    const segs = [...R.querySelectorAll("[data-sc-segment]")].map((el, i) => {
      const v = el.querySelector("video");
      return {
        i, label: el.dataset.scWaypoint || "",
        op: +(parseFloat(getComputedStyle(el).opacity) || 0).toFixed(3),
        painted: el.classList.contains("sc-has-clip"),
        t: v ? +(v.currentTime || 0).toFixed(3) : null,
      };
    });
    const world = R.querySelector('[data-sc-mode="worldflight"]');
    // Bespoke fixed stages can use flow markers for document travel while all
    // visible motion happens outside the engine's pin/scrub devices. Those
    // pages publish a compact representation of their actual visual state so
    // dead-scroll verification does not silently skip the whole experience.
    const customEls = [...R.querySelectorAll("[data-sc-verify-state]")];
    const custom = customEls.map((el) => el.getAttribute("data-sc-verify-state") || "");
    const customHold = customEls.some((el) => el.getAttribute("data-sc-verify-hold") === "true");
    return {
      cues: vis, clips, rails, wipes, act, stages, segs, custom, customHold,
      seg: world ? +(world.style.getPropertyValue("--sc-seg") || -1) : null,
      segp: world ? +(world.style.getPropertyValue("--sc-segp") || 0) : null,
      bg: getComputedStyle(R === document ? document.documentElement : R).getPropertyValue("--sc-canvas").trim(),
    };
  });

  // Flat NN.png so ffmpeg can read the set as a numbered sequence for the
  // contact sheet. The scroll offset lives in report.json, not the filename.
  const name = `${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: path.join(OUT, name) });

  // Contrast, measured on the COMPOSITED page rather than on the source media.
  // Sampling the video directly ignores every scrim, gradient and blend on top
  // of it, so a page can read as failing while looking fine, or the reverse.
  // Hide the text, shoot the same frame, hand the pixels back to the page, and
  // sample the real background under each line. Text over a scrubbing clip is
  // the one contrast case a static audit cannot cover: the frame beneath a
  // headline changes as you scroll, so it can pass on the poster and fail three
  // hundred pixels later. The direction is picked per line: light type fails on
  // the brightest patch, dark type on the darkest one.
  //
  // Fixed chrome is hidden along with the text. A fixed bar paints in FRONT of
  // whatever scrolls under it, so its own mark is not the background behind a
  // headline passing beneath it, and leaving it in reports a spurious failure
  // on an act that is fine.
  //
  // Ink mask. Grading every pixel of the element box graded things that are not
  // behind the text: the gaps between lines, and a foreground plane painted OVER
  // part of a headline (a cut-out figure or grass standing in front of the
  // type). So first repaint every gradable cue's glyphs in a key colour and shoot
  // that frame: a pixel counts as visible ink only where the key colour actually
  // shows, inside the text's own line boxes (Range client rects). The hidden-text
  // frame below is then sampled at exactly those pixels.
  const inked = await page.evaluate(markInk);
  let inkShot = null;
  if (inked) {
    const tag = await page.addStyleTag({ content: inkCss() });
    inkShot = (await page.screenshot({ type: "png", scale: "css" })).toString("base64");
    await tag.evaluate((n) => n.remove());
  }
  // Chrome over text is its own finding (TEXT UNDER CHROME), measured while the
  // page is exactly as the reader sees it.
  const chrome = await page.evaluate(underChrome, { all: false, scope: SECTION });
  const stuck = await page.evaluate(stuckAct, SECTION);
  await page.evaluate(() => {
    document.querySelectorAll("body *").forEach((el) => {
      if (getComputedStyle(el).position !== "fixed") return;
      // A worldflight's stage and copy layer are fixed too, and they are the
      // exact opposite case: the stage IS the background behind every line, and
      // the copy layer carries the scrim that makes the line legible. Hiding
      // them samples the page ground instead of the film and reports the whole
      // page as failing while it looks fine.
      if (el.closest("[data-sc-world],[data-sc-world-copy]")) return;
      el.setAttribute("data-sc-shot-fixed", "");
    });
  });
  await page.addStyleTag({
    content: "[data-sc-cue],[data-sc-cue] *,[data-sc-copy],[data-sc-copy] *," +
             "[data-sc-shot-fixed]{visibility:hidden!important}",
  });
  const bare = (await page.screenshot({ type: "jpeg", quality: 80, scale: "css" })).toString("base64");
  const contrast = await page.evaluate(async ({ b64, ink }) => {
    const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
    const decode = async (src) => {
      const im = new Image();
      im.src = src;
      await im.decode();
      const cv = document.createElement("canvas");
      cv.width = im.width; cv.height = im.height;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      return { w: im.width, h: im.height, d: cx.getImageData(0, 0, im.width, im.height).data };
    };
    const back = await decode("data:image/jpeg;base64," + b64);
    const mask = ink ? await decode("data:image/png;base64," + ink) : null;
    // Screenshots are CSS-pixel sized (scale: "css"), so one CSS px is one pixel.
    const isKey = (i) => mask.d[i] > 200 && mask.d[i + 1] < 70 && mask.d[i + 2] > 200;
    const lum = (r, gr, b) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
    };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const cueOpacity = (el) => {
      const o = parseFloat(getComputedStyle(el).opacity) || 0;
      const units = el.querySelectorAll(".sc-split__i");
      if (!units.length) return o;
      let m = 0;
      units.forEach((u) => { m = Math.max(m, parseFloat(getComputedStyle(u).opacity) || 0); });
      return o * m;
    };
    const out = [];
    R.querySelectorAll("[data-sc-shot-ink]").forEach((el) => {
      const cs = getComputedStyle(el);
      const fg = cs.color.match(/[\d.]+/g).map(Number);
      const fl = lum(fg[0], fg[1], fg[2]);
      // An element that paints its own opaque background (a button, a chip) is
      // an ordinary static contrast case: grade its text against that fill, not
      // against whatever the page happens to show behind it. Hiding the element
      // to sample the backdrop necessarily hides its background too, so without
      // this every solid CTA reports a spurious failure.
      const bg = (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
      const opaqueBg = bg.length >= 3 && (bg.length < 4 || bg[3] > 0.5);
      if (opaqueBg) {
        const bl = lum(bg[0], bg[1], bg[2]);
        out.push({
          t: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
          dir: "own-fill",
          worst: +ratio(fl, bl).toFixed(2), mean: +ratio(fl, bl).toFixed(2),
        });
        return;
      }
      // The background behind each VISIBLE ink pixel: key colour in the ink
      // frame, inside the text's own line boxes, clamped to the viewport. The
      // part of a pinned act's copy above the fold, glyphs a foreground plane
      // covers, and the empty box around the lines are all left out, because
      // none of them is the background behind anything the reader can see.
      if (!mask) return;
      const Ls = [];
      const seen = new Set();
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n; (n = tw.nextNode());) {
        if (!n.nodeValue.trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        for (const b of rg.getClientRects()) {
          const x0 = Math.max(0, Math.floor(b.left)), x1 = Math.min(mask.w, Math.ceil(b.right));
          const y0 = Math.max(0, Math.floor(b.top)), y1 = Math.min(mask.h, Math.ceil(b.bottom));
          for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) {
              const k = (yy * mask.w + xx) * 4;
              if (seen.has(k) || !isKey(k)) continue;
              seen.add(k);
              Ls.push(lum(back.d[k], back.d[k + 1], back.d[k + 2]));
            }
          }
        }
      }
      // Fewer than a few glyph strokes' worth of visible ink: the line is
      // covered or clipped, and there is nothing a reader sees to grade.
      if (Ls.length < 12) return;
      Ls.sort((a, b) => a - b);
      const at = (q) => Ls[Math.min(Ls.length - 1, Math.floor(q * (Ls.length - 1)))];
      const meanL = Ls.reduce((s, v) => s + v, 0) / Ls.length;
      // Pick the direction from the foreground. Light type on a dark page fails
      // on the brightest patch under it; dark type on a light page (a high-key
      // world, ink over media) fails on the DARKEST patch, and grading that
      // against the brightest is the most lenient reading available, so a page
      // can report clean over text that is failing. Compare the ink to the mean
      // background and grade against whichever extreme is on the ink's own side.
      // The extreme is the 95th (or 5th) percentile of the ink pixels, so a
      // handful of stray pixels at a glyph edge cannot decide the verdict.
      const dark = fl < meanL;
      out.push({
        t: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
        dir: dark ? "dark-on-light" : "light-on-dark",
        worst: +ratio(fl, dark ? at(0.05) : at(0.95)).toFixed(2),
        mean: +ratio(fl, meanL).toFixed(2),
        px: Ls.length,
      });
    });
    return out;
  }, { b64: bare, ink: inkShot });
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("style")].pop();
    if (t && t.textContent.includes("data-sc-cue")) t.remove();
    document.querySelectorAll("[data-sc-shot-fixed]").forEach((el) => el.removeAttribute("data-sc-shot-fixed"));
    document.querySelectorAll("[data-sc-shot-ink]").forEach((el) => el.removeAttribute("data-sc-shot-ink"));
  });

  report.push({ i, y, pct: +(p * 100).toFixed(0), settled, contrast, ...state, chrome, stuck });
  if (WORLD) {
    console.log(`  ${name}  settled=${settled}  copy=${state.cues.length}  leg=${state.seg}@${state.segp}  ` +
      `legs=${state.segs.map((g) => `${g.op > 0.002 ? (g.painted ? g.t : "poster") : "-"}${g.op > 0.002 && g.op < 0.998 ? "*" + g.op : ""}`).join(",")}`);
  } else {
    console.log(`  ${name}  settled=${settled}  cues=${state.cues.length}  clips=${state.clips.map((c) => (c.painted ? c.t : "poster")).join(",")}`);
  }
}

// Lite: did the page actually see the slow connection, and did the engine
// act on it? Read before writing report.json so the verdict is recorded.
let lite = null;
if (LITE) {
  lite = await page.evaluate(() => {
    const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
    const host = R === document ? document.documentElement : R;
    const insts = (window.ScrollCraft && window.ScrollCraft.instances) || [];
    const modes = insts.map((i) => i.media).filter((m) => typeof m === "string");
    const c = navigator.connection;
    return {
      installed: !!c && c === window.__scConnection && c.saveData === true && c.effectiveType === "2g",
      engineMedia: modes.length ? [...new Set(modes)].join(",") : null,
      scLite: host.classList.contains("sc-lite"),
    };
  });
  lite.clipRequests = [...new Set(liteClipRequests)];
}

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ doc, report, consoleErrors, failed, firstChrome, ...(lite ? { lite } : {}) }, null, 2));

if (lite) {
  console.log(`\nLITE: navigator.connection override ${lite.installed ? "installed (saveData=true, effectiveType=2g)" : "NOT INSTALLED"}`);
  console.log(`  engine media mode: ${lite.engineMedia || "not reported (this engine predates media mode)"}`);
  console.log(`  sc-lite class on ${SECTION || "<html>"}: ${lite.scLite ? "present" : "ABSENT"}`);
  console.log(lite.clipRequests.length
    ? `  LITE NOT HONOURED: ${lite.clipRequests.length} clip request(s) during the walk:\n    ` + lite.clipRequests.join("\n    ")
    : "  no clip was requested during the walk");
}

if (consoleErrors.length) console.log("\nCONSOLE ERRORS:\n  " + consoleErrors.join("\n  "));
if (failed.length) console.log("\nFAILED REQUESTS:\n  " + failed.join("\n  "));

// Dead-scroll detector: consecutive positions where nothing visibly changed.
// This is the failure the eye misses and the reason to shoot contiguously.
// Opacity counts as change: a cue mid-fade is motion, and comparing only which
// cues exist would call a crossfade dead.
const sig = (s) => JSON.stringify([
  s.cues.map((c) => c.t + ":" + c.o),
  s.clips.map((c) => c.t),
  s.rails,
  s.wipes,
  s.stages,
  s.custom || [],
]);
// Only inside pinned acts. A flow section or a footer that holds still across
// two sample positions is a page behaving correctly, not dead scroll, and
// flagging it trains you to ignore the signal.
const PINNED = new Set(["scrub", "pin", "pan"]);
const dead = [];
if (WORLD) {
  // Every pixel of a worldflight track is pinned by construction, so there is
  // no "correctly still" region to exclude and the whole page is fair game.
  // Three independent things can carry the motion: the film advancing, a leg
  // dissolving into the next, and a copy window opening or closing. Dead scroll
  // is all three holding at once.
  const wsig = (s) => JSON.stringify([
    s.segs.map((g) => g.t),
    s.segs.map((g) => g.op),
    s.cues.map((c) => c.t + ":" + c.o),
  ]);
  // Not under reduced motion. There the film is deliberately never fetched, so
  // the middle of a leg holds a single still frame and every pair of samples in
  // it is identical BY DESIGN. Flagging that reports the accessibility path as
  // broken every single run, which is how a real finding gets ignored. What
  // matters here is whether the story still reads, and the copy-window and
  // contrast passes below answer that.
  for (let i = 1; !HOLD && i < report.length; i++) {
    const a = report[i - 1], b = report[i];
    // Tighter than the act gate: a leg is about one viewport of scroll, so a
    // quarter-viewport window would only ever compare four points per leg.
    if (b.y - a.y < doc.vh * 0.12) continue;
    if (wsig(a) === wsig(b)) {
      dead.push(`${a.pct}% -> ${b.pct}% (leg ${a.seg} > ${b.seg})`);
    }
  }
} else {
  for (let i = 1; i < report.length; i++) {
    const a = report[i - 1], b = report[i];
    const hasCustomState = (a.custom?.length || 0) > 0 || (b.custom?.length || 0) > 0;
    if (!PINNED.has(a.act) && !PINNED.has(b.act) && !hasCustomState) continue;
    // A page may explicitly declare an authored hold, such as a resolved close
    // or the stable accessibility frame under reduced motion. It has to be
    // declared by the visible stage; ordinary flow content stays exempt as it
    // was before this custom-state path existed.
    if (a.customHold && b.customHold) continue;
    // Two samples a few dozen pixels apart SHOULD look the same. Only flag a gap
    // wide enough that a reader would notice nothing happening in it.
    if (b.y - a.y < doc.vh * 0.25) continue;
    if (sig(a) === sig(b)) dead.push(`${a.pct}% -> ${b.pct}% (${a.act} > ${b.act})`);
  }
}
console.log(dead.length ? `\nDEAD SCROLL between: ${dead.join(", ")}`
  : WORLD && REDUCED ? "\ndead-scroll check skipped: reduced motion holds each leg on one still frame by design"
  : WORLD && LITE ? "\ndead-scroll check skipped: lite mode holds each leg on its poster by design"
  : "\nno dead scroll detected");

// FROZEN CLIP. The reader is scrolling, a scrub stage is on screen, and its
// playhead is not moving: a still photograph sliding up the page. Dead scroll
// cannot see this, because the stage IS moving, which is the whole problem.
//
// A hold on the first or last frame is always a defect. A hold in the middle
// can be an intentional `dwell` settle, so it only counts once it outlasts one.
// Skipped under reduced motion, where no clip is ever fetched on purpose.
// Skipped under --lite for the same reason: posters hold by design.
if (!HOLD) {
  const nClips = report[0]?.clips?.length || 0;
  const VIS = 0.55, EPS = 0.012, MIN = doc.vh * 0.15;
  const frozen = [];
  for (let c = 0; c < nClips; c++) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const kind = run.t < 0.05 ? "entry" : (run.dur && run.t > run.dur - 0.08 ? "exit" : "mid");
      const need = kind === "mid" ? doc.vh * 0.5 : MIN;
      if (run.to - run.from >= need) frozen.push({ c, kind, ...run });
      run = null;
    };
    for (let i = 1; i < report.length; i++) {
      const a = report[i - 1].clips?.[c], b = report[i].clips?.[c];
      if (!a || !b) { flush(); continue; }
      const seen = a.vis >= VIS && b.vis >= VIS;
      const stuck = Math.abs(b.t - a.t) < EPS;
      if (seen && stuck && b.painted) {
        if (!run) run = { from: report[i - 1].y, to: report[i].y, t: b.t, dur: b.dur };
        else run.to = report[i].y;
      } else flush();
    }
    flush();
  }
  if (frozen.length) {
    console.log("\nFROZEN CLIP (still image while the page moves):\n  " + frozen.map((f) => {
      const px = f.to - f.from;
      const where = f.kind === "entry" ? "held on its FIRST frame while the stage slides in"
        : f.kind === "exit" ? "held on its LAST frame while the stage slides out"
        : `held mid-clip at ${f.t.toFixed(2)}s, longer than a dwell settle`;
      return `clip ${f.c}: ${px}px (${(px / doc.vh).toFixed(2)} viewports) ${where}`;
    }).join("\n  ") + "\n  Fix: let the clip map across the stage's whole visible life. That is the\n  engine default; data-sc-clip-map=\"travel\" turns it off. See devices.md.");
  } else if (nClips) {
    console.log(`all ${nClips} scrub clip(s) keep moving whenever they are on screen`);
  }
}

// Worldflight findings. A leg that never reaches full opacity is a weight or a
// seam that is wrong: the reader is shown a permanent dissolve between two
// clips and never the leg itself. A leg stuck on its poster is a clip that
// never loaded or never decoded, and it passes every other check on this page
// because a poster looks exactly like a paused film.
if (WORLD) {
  const segPeak = {};
  report.forEach((s) => (s.segs || []).forEach((g) => {
    const k = `${g.i}${g.label ? ' "' + g.label + '"' : ""}`;
    segPeak[k] = segPeak[k] || { op: 0, painted: false, hasClip: g.t !== null };
    segPeak[k].op = Math.max(segPeak[k].op, g.op);
    segPeak[k].painted = segPeak[k].painted || g.painted;
  }));
  const faint = Object.entries(segPeak).filter(([, v]) => v.op < 0.99);
  // Under reduced motion no clip is ever fetched, on purpose. Every leg is
  // legitimately on its poster, and reporting that as a fault buries the one
  // finding this pass exists for: whether the story still reads without motion.
  const posters = HOLD ? [] : Object.entries(segPeak).filter(([, v]) => v.hasClip && !v.painted);
  if (faint.length) console.log("\nLEGS THAT NEVER REACH FULL OPACITY:\n  " +
    faint.map(([k, v]) => `${v.op.toFixed(2)} leg ${k}`).join("\n  "));
  if (posters.length) console.log("\nLEGS STUCK ON POSTER (clip never painted):\n  " +
    posters.map(([k]) => `leg ${k}`).join("\n  "));
  if (!faint.length && !posters.length)
    console.log(`all ${Object.keys(segPeak).length} legs reach full opacity` +
      (REDUCED ? " (posters only, as reduced motion requires)"
        : LITE ? " (posters only, as lite mode requires)" : " and paint a real frame"));
}

// Cues that never reach full strength anywhere on the page. A headline peaking
// at 0.6 is a mis-set cue window, and it is invisible as a bug because the
// element IS there, just never quite arriving.
const peak = {};
report.forEach((s) => s.cues.forEach((c) => { peak[c.t] = Math.max(peak[c.t] || 0, c.o); }));
const weak = Object.entries(peak).filter(([, o]) => o < 0.8);
if (weak.length) console.log("\nCUES THAT NEVER PEAK:\n  " + weak.map(([t, o]) => `${o} "${t}"`).join("\n  "));

// Contrast over media, graded at the worst frame each line is ever shown on.
const worstBy = {};
report.forEach((s) => (s.contrast || []).forEach((c) => {
  if (!worstBy[c.t] || c.worst < worstBy[c.t].worst) worstBy[c.t] = c;
}));
const fails = Object.values(worstBy).filter((c) => c.worst < 3);
const thin = Object.values(worstBy).filter((c) => c.worst >= 3 && c.worst < 4.5);
if (fails.length) console.log("\nCONTRAST FAIL (worst frame < 3:1):\n  " +
  fails.map((c) => `${c.worst}:1 (mean ${c.mean}) "${c.t}"`).join("\n  "));
if (thin.length) console.log("\nCONTRAST THIN (3:1 to 4.5:1, ok for large display type only):\n  " +
  thin.map((c) => `${c.worst}:1 "${c.t}"`).join("\n  "));
if (!fails.length && !thin.length && Object.keys(worstBy).length)
  console.log("\ncontrast over media: all cues clear 4.5:1 at their worst frame");

reportChrome();
reportMotion();

await browser.close();

// Contact sheet. The point of shooting contiguously is to look at the frames
// side by side; a folder of 20 PNGs does not get looked at that way.
const FFMPEG = [
  process.env.SCROLLCRAFT_FFMPEG,
  ...(fs.existsSync(path.join(process.env.HOME || "", "AppData/Local/Microsoft/WinGet/Packages"))
    ? fs.readdirSync(path.join(process.env.HOME, "AppData/Local/Microsoft/WinGet/Packages"))
        .filter((d) => d.startsWith("Gyan.FFmpeg"))
        .flatMap((d) => {
          const base = path.join(process.env.HOME, "AppData/Local/Microsoft/WinGet/Packages", d);
          return fs.readdirSync(base).map((v) => path.join(base, v, "bin/ffmpeg.exe"));
        })
    : []),
  "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "ffmpeg",
].find((p) => p && (p === "ffmpeg" || fs.existsSync(p)));

if (FFMPEG) {
  const cols = Math.min(5, report.length);
  const rows = Math.ceil(report.length / cols);
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(FFMPEG, [
    "-y", "-v", "error", "-i", path.join(OUT, "%02d.png"),
    "-vf", `scale=520:-1,tile=${cols}x${rows}`, "-frames:v", "1",
    path.join(OUT, "sheet.png"),
  ]);
  if (r.status === 0) console.log(`contact sheet: ${path.join(OUT, "sheet.png")}`);
  else console.log("contact sheet skipped (needs a full ffmpeg build; scale/tile are missing from stripped ones)");
}

console.log(`\nshots + report.json in ${OUT}`);

// ===================================================================== helpers
// Function declarations, hoisted; the in-page ones are handed to
// page.evaluate, so they may use nothing from this module's scope.

// Ink frame: every gradable cue's glyphs in one key colour, fattened by a
// stroke so thin type still yields solid key pixels, with nothing animating.
function inkCss() {
  return "[data-sc-shot-ink],[data-sc-shot-ink] *{color:#ff00ff!important;" +
  "-webkit-text-fill-color:#ff00ff!important;-webkit-text-stroke:2px #ff00ff!important;" +
  "text-shadow:none!important;transition:none!important}";
}

// In page: tag the cues the contrast pass grades (on screen, text, at or near
// full strength). Returns how many were tagged.
function markInk() {
  const R = (window.__scShotScope && document.querySelector(window.__scShotScope)) || document;
  const cueOpacity = (el) => {
    const o = parseFloat(getComputedStyle(el).opacity) || 0;
    const units = el.querySelectorAll(".sc-split__i");
    if (!units.length) return o;
    let m = 0;
    units.forEach((u) => { m = Math.max(m, parseFloat(getComputedStyle(u).opacity) || 0); });
    return o * m;
  };
  let n = 0;
  R.querySelectorAll("[data-sc-cue],[data-sc-copy]").forEach((el) => {
    if (cueOpacity(el) < 0.85) return;
    if (!(el.textContent || "").trim()) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) return;
    el.setAttribute("data-sc-shot-ink", "");
    n++;
  });
  return n;
}

// In page: the pinned act whose stage is stuck right now, with what could make
// it look alive: its large visual layers (geometry and opacity), clip times,
// rail offsets, cue strengths, and any published verify state.
function stuckAct(scope) {
  const R = (scope && document.querySelector(scope)) || document;
  const vw = innerWidth, vh = innerHeight;
  const acts = [...R.querySelectorAll("[data-sc-act]")];
  // Stuck means the stage itself sits at the top of the viewport. An act whose
  // stage fails to pin (the engine warns about that) is never "stuck".
  const k = acts.findIndex((a) => {
    if (!["scrub", "pin", "pan"].includes(a.dataset.scAct)) return false;
    const r = a.getBoundingClientRect();
    const s = (a.querySelector("[data-sc-stage]") || a).getBoundingClientRect();
    return r.top <= 1 && r.bottom >= vh - 1 && Math.abs(s.top) <= 1;
  });
  if (k < 0) return null;
  const a = acts[k];
  const st = a.querySelector("[data-sc-stage]") || a;
  const eff = (el) => {
    let o = 1;
    for (let e = el; e && e !== a; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const layers = [];
  [...st.querySelectorAll("*")].forEach((el, i) => {
    const tag = el.tagName;
    const bgi = getComputedStyle(el).backgroundImage;
    const media = ["IMG", "VIDEO", "CANVAS", "svg"].includes(tag) || /url\(/.test(bgi);
    // A gradient-only layer (light, mist, scrim) is atmosphere: its fade is not
    // the picture answering the scroll, so it is kept but marked.
    if (!media && bgi === "none") return;
    const r = el.getBoundingClientRect();
    const iw = Math.min(r.right, vw) - Math.max(r.left, 0), ih = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (iw <= 0 || ih <= 0 || iw * ih < 0.25 * vw * vh) return;
    layers.push({ i, media, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, o: +eff(el).toFixed(3),
      vx0: Math.max(r.left, 0), vy0: Math.max(r.top, 0), vx1: Math.min(r.right, vw), vy1: Math.min(r.bottom, vh) });
  });
  const cues = [...a.querySelectorAll("[data-sc-cue]")].map((el) => {
    const o = parseFloat(getComputedStyle(el).opacity) || 0;
    const units = el.querySelectorAll(".sc-split__i");
    if (!units.length) return +o.toFixed(3);
    let m = 0;
    units.forEach((u) => { m = Math.max(m, parseFloat(getComputedStyle(u).opacity) || 0); });
    return +(o * m).toFixed(3);
  });
  return {
    k, device: a.dataset.scAct,
    label: `act ${k + 1}` + (a.id ? " #" + a.id
      : ((typeof a.className === "string" ? a.className : "").split(/\s+/).filter((c) => c && !/^sc-/.test(c)).slice(0, 1).map((c) => " ." + c)[0] || "")),
    layers, cues,
    clips: [...a.querySelectorAll("video[data-sc-scrub]")].map((v) => +(v.currentTime || 0).toFixed(3)),
    rails: [...a.querySelectorAll("[data-sc-pan]")].map((r) => Math.round(new DOMMatrixReadOnly(getComputedStyle(r).transform).m41)),
    custom: [...a.querySelectorAll("[data-sc-verify-state]")].map((e) => e.getAttribute("data-sc-verify-state") || ""),
  };
}

// TEXT UNDER CHROME: the first screen, plus every sample where a pinned cue at
// full strength sat under the header or other fixed chrome.
function reportChrome() {
  const rows = new Map();
  (firstChrome || []).forEach((h) => rows.set(h.t + "|" + h.by, { ...h, where: ["first screen"] }));
  report.forEach((s) => (s.chrome || []).forEach((h) => {
    const k = h.t + "|" + h.by;
    const r = rows.get(k) || { ...h, where: [] };
    r.px = Math.max(r.px, h.px);
    if (!r.where.includes(`${s.pct}%`)) r.where.push(`${s.pct}%`);
    rows.set(k, r);
  }));
  if (!rows.size) { console.log("\ntext clears fixed and sticky chrome on the first screen and in every pinned act"); return; }
  console.log("\nTEXT UNDER CHROME (ink overlapped by fixed or sticky chrome while it is meant to be seen):\n  " +
    [...rows.values()].map((r) => `"${r.t}" under ${r.by}, ${r.px}px deep, at ${r.where.slice(0, 6).join(", ")}${r.where.length > 6 ? " ..." : ""}`).join("\n  ") +
    "\n  Fix: clear the header height on the first screen (a --sc-chrome-h token, safe top padding, scroll-padding-top).");
}

// MOTION FEEL: a pinned act the reader scrolls through while nothing visible
// answers. Measured only while the stage is stuck (entry and exit slides
// excluded) and only across at least MOTION_MIN_TRAVEL viewports of scroll.
function reportMotion() {
  const MOTION_MIN_TRAVEL = 0.4;   // viewports of pinned scroll before a verdict
  const MOTION_MIN_LAYER = 0.05;   // largest visible layer travel, fraction of the viewport ("a few percent" is a still)
  const MOTION_MIN_FADE = 0.25;    // largest layer opacity change
  if (WORLD) return;
  const groups = new Map();
  report.forEach((s) => { if (s.stuck) groups.set(s.stuck.k, [...(groups.get(s.stuck.k) || []), s]); });
  const flagged = [], checked = [];
  for (const [, ss] of groups) {
    if (ss.length < 3) continue;
    const travel = (ss[ss.length - 1].y - ss[0].y) / doc.vh;
    if (travel < MOTION_MIN_TRAVEL) continue;
    const a0 = ss[0].stuck;
    // Largest VISIBLE displacement of a layer's content, in px: map each corner
    // of the layer's on-screen part through the layer's shift and scale and
    // take the furthest move. A cover photo scaled 2% moves its off-screen
    // edges a lot and what the reader sees barely at all; this counts the
    // latter. Fades count only for photo, video and canvas layers.
    let move = 0, fade = 0;
    for (const L of a0.layers) {
      for (const s of ss) {
        const M = s.stuck.layers.find((x) => x.i === L.i);
        if (!M) continue;
        const sx = M.w / (L.w || 1), sy = M.h / (L.h || 1);
        for (const [px, py] of [[L.vx0, L.vy0], [L.vx1, L.vy0], [L.vx0, L.vy1], [L.vx1, L.vy1]]) {
          const nx = M.x + (px - L.x) * sx, ny = M.y + (py - L.y) * sy;
          move = Math.max(move, Math.hypot(nx - px, ny - py));
        }
        if (L.media) fade = Math.max(fade, Math.abs(M.o - L.o));
      }
    }
    const span = (f) => Math.max(0, ...ss.map((s) => Math.max(0, ...f(s))) ) - Math.min(...ss.map((s) => Math.min(Infinity, ...f(s))));
    const clip = a0.clips.length ? span((s) => s.stuck.clips) : 0;
    const rail = a0.rails.length ? span((s) => s.stuck.rails) : 0;
    const custom = new Set(ss.map((s) => JSON.stringify(s.stuck.custom))).size > 1;
    let cueSteps = 0;
    for (let i = 1; i < ss.length; i++) {
      if (ss[i].stuck.cues.some((o, j) => Math.abs(o - (ss[i - 1].stuck.cues[j] ?? o)) >= 0.1)) cueSteps++;
    }
    const row = {
      label: `${a0.label} (${a0.device})`, travel, layers: a0.layers.length, move: move / doc.vh, fade,
      clip, rail: rail / W, custom, cueSteps, steps: ss.length - 1,
    };
    checked.push(row);
    // Alive when the picture answers: a clip advancing, a rail travelling, a
    // bespoke stage publishing a changing state, a layer moving or a photo
    // layer fading visibly, or cues changing on at least half the steps.
    const alive = clip > 0.1 || row.rail > 0.05 || custom || row.move >= MOTION_MIN_LAYER ||
      fade >= MOTION_MIN_FADE || cueSteps / row.steps >= 0.5;
    if (!alive) flagged.push(row);
  }
  if (process.env.SCROLLCRAFT_MOTION_DEBUG) console.log("\nmotion feel (debug):\n  " + checked.map((r) => JSON.stringify(r)).join("\n  "));
  if (flagged.length) {
    console.log("\nNEAR-STATIC PINNED ACT (the reader scrolls and the picture barely answers):\n  " + flagged.map((r) =>
      `${r.label}: pinned for ${r.travel.toFixed(2)} viewports; ` +
      (r.layers ? `its large layers move ${(r.move * 100).toFixed(1)}% of the viewport, photo fades ${r.fade.toFixed(2)}; ` : "no large layer; ") +
      (r.label.endsWith("(pan)") ? `the rail travels ${(r.rail * 100).toFixed(1)}% of the width; ` : "") +
      `cues change in ${r.cueSteps} of ${r.steps} steps`).join("\n  ") +
      `\n  Fix: give the planes real travel (under ${Math.round(MOTION_MIN_LAYER * 100)}% of the viewport reads as a still), make the rail overflow,` +
      `\n  shorten the span, or give each step of the pin a visible change.`);
  } else if (checked.length) {
    console.log(`motion feel: ${checked.length} pinned act(s) respond to scroll`);
  }
}
