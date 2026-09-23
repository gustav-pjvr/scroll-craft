#!/usr/bin/env node
/**
 * scrollcraft seek-lab: measure scrub-seek latency for every encode-lab
 * candidate in installed Chrome.
 *
 * Loads each file exactly the way the engine's loadClip() does
 * (engine/scrollcraft.js:978 to :1043): fetch the src, take a Blob, attach
 * `loadedmetadata`/`seeked` listeners before touching the element, set
 * preload=auto, muted=true, playsInline=true, create an object URL from the
 * blob and assign it to `video.src`, then prime with a play() followed by a
 * pause() once play() resolves (engine/scrollcraft.js:1442 to :1469,
 * primeClip). Only after priming does it issue seeks.
 *
 * Then it runs 60 (default) seeded pseudo-random seeks against the primed
 * clip, timing each from the `currentTime` write to the `seeked` event, and
 * reports p50 and p95 in ms per file. This is the number the engine's lerp
 * loop is rate-limited by: it never issues a seek while one is pending
 * (scrollcraft.js:1006 comment area).
 *
 * file:// blocks the fetch (verify.md:26), so this serves lab/encode with
 * scripts/serve.mjs first.
 *
 *   node seek-lab.mjs --dir lab/encode [--seeks 60] [--seed 7] [--port 4642]
 *
 * Uses INSTALLED Chrome via playwright-core, same resolution as shoot.mjs:
 * bundled Chromium ships without the h264 decoder, so a scrub clip would
 * silently fail to paint and seeks would never fire `seeked`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let chromium;
try {
  ({ chromium } = createRequire(path.join(process.cwd(), "package.json"))("playwright-core"));
} catch {
  console.error("playwright-core not found. Run this with cwd inside lab/ (or wherever it is installed):\n  npm i playwright-core");
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };

const DIR = path.resolve(arg("--dir", "lab/encode"));
const SEEKS = parseInt(arg("--seeks", "60"), 10);
const SEED = parseInt(arg("--seed", "7"), 10);
const PORT = parseInt(arg("--port", "4642"), 10); // packet E range: 4641 to 4649
if (PORT < 4641 || PORT > 4649) {
  console.error(`ERROR: --port ${PORT} is outside Packet E's assigned range 4641 to 4649.`);
  process.exit(1);
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

if (!fs.existsSync(path.join(DIR, "harness.html"))) {
  console.error(`ERROR: ${path.join(DIR, "harness.html")} not found (seek-lab needs its test harness page beside the candidates).`);
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mp4")).sort();
if (files.length === 0) {
  console.error(`ERROR: no .mp4 candidates in ${DIR}. Run encode-lab.mjs first.`);
  process.exit(1);
}
console.log(`seek-lab: ${files.length} candidate(s) in ${DIR}, ${SEEKS} seeks each, seed ${SEED}`);

// ---------------------------------------------------------------------------
// scripts/serve.mjs, on our own port range. file:// blocks the Blob fetch.
// ---------------------------------------------------------------------------
const serveScript = path.join(__dirname, "serve.mjs");

function waitForPort(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`serve.mjs did not open port ${port} in time`));
        else setTimeout(attempt, 100);
      });
    })();
  });
}

const server = spawn(process.execPath, [serveScript, "--root", DIR, "--port", String(PORT)], {
  stdio: ["ignore", "ignore", "inherit"],
});
let serverExited = false;
server.on("exit", () => { serverExited = true; });

function stopServer() {
  if (!serverExited && !server.killed) server.kill();
}
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

await waitForPort(PORT);

// ---------------------------------------------------------------------------
// Per-file measurement, run in the page.
// ---------------------------------------------------------------------------
async function measureFile(page, filename, seeksCount, seed) {
  return page.evaluate(async ({ filename, seeksCount, seed }) => {
    // Same seeded PRNG as encode-lab.mjs, so the sequence is reproducible.
    function mulberry32(s) {
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const el = document.getElementById("v");
    const t0Fetch = performance.now();

    // --- exactly loadClip() (scrollcraft.js:978 to :1043) ------------------
    const res = await fetch(filename);
    if (!res.ok) throw new Error(`fetch ${filename} -> ${res.status}`);
    const blob = await res.blob();

    const loadedMetadata = new Promise((resolve) => {
      el.addEventListener("loadedmetadata", resolve, { once: true });
    });
    const firstSeeked = new Promise((resolve) => {
      el.addEventListener("seeked", resolve, { once: true });
    });

    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    const url = URL.createObjectURL(blob);
    el.src = url;

    await loadedMetadata;
    const loadMs = performance.now() - t0Fetch;
    // The engine forces one seek even to target 0 (scrollcraft.js:1008), which
    // is what makes the first `seeked` (and therefore the poster-to-clip
    // reveal) fire. Mirror it, then prime.
    el.currentTime = Math.max(0.001, 0);
    await firstSeeked;

    // --- exactly primeClip() (scrollcraft.js:1442 to :1469): play() then
    // pause() once it resolves, so the decoder is warm before we time seeks.
    const t0Prime = performance.now();
    try {
      const p = el.play();
      if (p && p.then) await p;
    } catch (e) { /* rejection is harmless here, mirrors the engine's fail() */ }
    try { el.pause(); } catch (e) {}
    const primeMs = performance.now() - t0Prime;

    // --- 60 seeded pseudo-random seeks, sequential (the engine never issues
    // a seek while one is pending) -----------------------------------------
    const rand = mulberry32(seed);
    const duration = el.duration || 5;
    const samples = [];
    for (let i = 0; i < seeksCount; i++) {
      const target = Math.min(duration - 0.01, Math.max(0, rand() * duration));
      const done = new Promise((resolve) => {
        const onSeeked = () => { el.removeEventListener("seeked", onSeeked); resolve(true); };
        el.addEventListener("seeked", onSeeked);
        setTimeout(() => { el.removeEventListener("seeked", onSeeked); resolve(false); }, 4000);
      });
      const t0 = performance.now();
      el.currentTime = target;
      const ok = await done;
      samples.push(ok ? performance.now() - t0 : null);
    }

    URL.revokeObjectURL(url);
    return { loadMs, primeMs, samples, duration };
  }, { filename, seeksCount, seed });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://localhost:${PORT}/harness.html`, { waitUntil: "domcontentloaded" });

const rows = [];
for (const file of files) {
  process.stdout.write(`  seeking ${file} ... `);
  // Fresh element per file: reuse would carry over the previous clip's
  // buffered ranges and decoder state, which is not what a real act does.
  await page.evaluate(() => {
    const old = document.getElementById("v");
    const fresh = document.createElement("video");
    fresh.id = "v"; fresh.muted = true; fresh.playsInline = true;
    old.replaceWith(fresh);
  });
  let result;
  try {
    result = await measureFile(page, file, SEEKS, SEED);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    rows.push({ file, error: String(e.message || e) });
    continue;
  }
  const timed = result.samples.filter((v) => v != null).sort((a, b) => a - b);
  const timeouts = result.samples.length - timed.length;
  const p50 = percentile(timed, 50);
  const p95 = percentile(timed, 95);
  console.log(`p50=${p50?.toFixed(1)}ms  p95=${p95?.toFixed(1)}ms  loadMs=${result.loadMs.toFixed(0)}  timeouts=${timeouts}`);
  rows.push({
    file, duration: result.duration, loadMs: result.loadMs, primeMs: result.primeMs,
    seeks: result.samples.length, timeouts, p50, p95,
  });
}

await browser.close();
stopServer();

fs.writeFileSync(
  path.join(DIR, "seek-results.json"),
  JSON.stringify({ generated: new Date().toISOString(), dir: DIR, seeks: SEEKS, seed: SEED, port: PORT, rows }, null, 2)
);

const md = [];
md.push(`# seek-lab results`);
md.push("");
md.push(`${SEEKS} seeks per file, seed ${SEED}, Chrome via playwright-core, port ${PORT}.`);
md.push("");
md.push("| file | p50 (ms) | p95 (ms) | seeks | timeouts | load (ms) |");
md.push("|---|---|---|---|---|---|");
for (const r of rows) {
  if (r.error) { md.push(`| ${r.file} | ERROR | ${r.error} | | | |`); continue; }
  md.push(`| ${r.file} | ${r.p50?.toFixed(1)} | ${r.p95?.toFixed(1)} | ${r.seeks} | ${r.timeouts} | ${r.loadMs.toFixed(0)} |`);
}
fs.writeFileSync(path.join(DIR, "seek-results.md"), md.join("\n") + "\n");

console.log(`\nwrote:\n  ${path.join(DIR, "seek-results.json")}\n  ${path.join(DIR, "seek-results.md")}`);
