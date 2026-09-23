#!/usr/bin/env node
/**
 * scrollcraft encode-lab: measure the `bed` tier grid so the numbers in
 * encode.sh and references/encode-tiers.md are a measurement, not a guess.
 *
 * Runs every cell of the bed-desktop and bed-mobile grids (DESIGN.md V4)
 * plus the two `hero` anchors through the exact filter chain encode.sh uses,
 * then for each output:
 *   - file size
 *   - SSIM and PSNR against the master, after upscaling the candidate back to
 *     the master's own resolution with lanczos (so downscale loss is charged
 *     to the candidate, not hidden by shrinking the reference)
 *   - the ACTUAL keyframe interval read back with ffprobe, to prove the GOP
 *     landed rather than trusting the flag
 *   - a three-frame contact strip (10%, 50%, 90% of the clip)
 *
 * Results land as JSON and a markdown table, plus a blind numbered copy of
 * the contact strips (mapping kept separately) for Gustav's visual pick, and
 * a phone-candidates.json manifest so the phone seek session (Packet A2's
 * device-diag.html) can be driven later without re-deriving the grid.
 *
 *   node encode-lab.mjs --in lab/source.mp4 --out lab/encode
 *   node encode-lab.mjs --in lab/source.mp4 --out lab/encode --tier hero
 *   node encode-lab.mjs --self-test
 *
 * Uses the same FULL-ffmpeg resolution as encode.sh: a stripped ffmpeg on
 * PATH silently lacks scale/ssim/psnr and fails with a syntax-looking error.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Acceptance rule (DESIGN.md V4): the smallest file whose ssim_all >= X. Ties
// within 2% file size go to the higher PSNR. Reject (return a rejected
// candidate, never a silent number) if the winner is not at least a third
// smaller than the hero anchor it sits under.
// ---------------------------------------------------------------------------
export function pick(rows, X, heroBytes) {
  const eligible = rows.filter((r) => r.ssim >= X);
  if (eligible.length === 0) {
    return { rejected: true, reason: `no candidate reaches ssim >= ${X}` };
  }
  const bySize = [...eligible].sort((a, b) => a.size - b.size);
  const smallest = bySize[0];
  const tieCeiling = smallest.size * 1.02;
  const ties = bySize.filter((r) => r.size <= tieCeiling);
  ties.sort((a, b) => b.psnr - a.psnr);
  const winner = ties[0];
  if (heroBytes != null) {
    const shrink = 1 - winner.size / heroBytes;
    if (shrink < 1 / 3) {
      return {
        ...winner,
        rejected: true,
        reason: `only ${(shrink * 100).toFixed(1)}% smaller than the hero anchor ` +
          `(${heroBytes} bytes); needs at least a third smaller`,
      };
    }
  }
  return { ...winner, rejected: false };
}

if (process.argv.includes("--self-test")) {
  // Synthetic table: three tiers of quality, deliberately including a near
  // tie in size (candidates B and C) to exercise the PSNR tie-break, and a
  // candidate that passes ssim but is too close to the hero anchor's size
  // to earn its place.
  const rows = [
    { name: "A-too-soft", size: 300_000, ssim: 0.90, psnr: 30 },
    { name: "B-tie-lo-psnr", size: 500_000, ssim: 0.97, psnr: 34 },
    { name: "C-tie-hi-psnr", size: 505_000, ssim: 0.975, psnr: 38 },
    { name: "D-bigger", size: 900_000, ssim: 0.99, psnr: 41 },
  ];

  // 1. Below-threshold candidates are excluded; the smallest that clears the
  //    bar wins, not the smallest overall (A is smaller than B but too soft).
  {
    const r = pick(rows, 0.95, 2_000_000);
    assert.equal(r.rejected, false);
    assert.equal(r.name, "C-tie-hi-psnr", "tie within 2% size goes to higher PSNR, not smaller size");
  }

  // 2. No tie: D is the only one clearing a stricter threshold.
  {
    const r = pick(rows, 0.985, 2_000_000);
    assert.equal(r.rejected, false);
    assert.equal(r.name, "D-bigger");
  }

  // 3. Nothing clears the bar.
  {
    const r = pick(rows, 0.999, 2_000_000);
    assert.equal(r.rejected, true);
    assert.match(r.reason, /no candidate reaches/);
  }

  // 4. Clears ssim but is not a third smaller than the hero anchor: rejected
  //    with a reason, not silently returned as a number.
  {
    const r = pick(rows, 0.95, 520_000); // C is only ~2.9% smaller than 520000
    assert.equal(r.rejected, true);
    assert.match(r.reason, /smaller than the hero anchor/);
  }

  // 5. Exactly a third smaller clears the floor (boundary, not strict >).
  {
    const heroBytes = 505_000 / (2 / 3); // makes C exactly 1/3 smaller
    const r = pick(rows, 0.95, Math.round(heroBytes));
    assert.equal(r.rejected, false);
  }

  console.log("encode-lab.mjs --self-test: 5/5 pick() assertions passed");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };

const IN = path.resolve(arg("--in", "lab/source.mp4"));
const OUT = path.resolve(arg("--out", "lab/encode"));
const TIER = arg("--tier", "all"); // bed | hero | all

if (!fs.existsSync(IN)) {
  console.error(`ERROR: master clip not found: ${IN}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ffmpeg resolution, mirroring encode.sh's pick_ffmpeg(): a stripped build on
// PATH carries maybe 50 filters and silently lacks scale/ssim/psnr/tile.
// ---------------------------------------------------------------------------
function findOnPath(exe) {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  const names = process.platform === "win32" ? [`${exe}.exe`, exe] : [exe];
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function filterCount(ffmpegPath) {
  const r = spawnSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return 0;
  return r.stdout.split("\n").length;
}

function pickFfmpeg() {
  const candidates = [
    process.env.SCROLLCRAFT_FFMPEG,
    findOnPath("ffmpeg"),
    "C:/Users/HP 865 G10/AppData/Local/Programs/ffmpeg/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe",
    "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg", "/snap/bin/ffmpeg",
  ].filter(Boolean);
  for (const cand of candidates) {
    if (fs.existsSync(cand) && filterCount(cand) > 200) return cand;
  }
  console.error("ERROR: no full ffmpeg build found. Set SCROLLCRAFT_FFMPEG to one.");
  process.exit(1);
}

const FFMPEG = pickFfmpeg();
const ffprobeGuess = path.join(path.dirname(FFMPEG), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const FFPROBE = fs.existsSync(ffprobeGuess) ? ffprobeGuess : findOnPath("ffprobe");
if (!FFPROBE) {
  console.error("ERROR: ffprobe not found beside ffmpeg or on PATH.");
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} exited ${r.status}\n${args.join(" ")}\n${r.stderr || ""}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Probe the master
// ---------------------------------------------------------------------------
function probeMaster(file) {
  const r = run(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
    "-show_entries", "format=duration,size",
    "-of", "json", file,
  ]);
  const j = JSON.parse(r.stdout);
  const s = j.streams[0];
  const [num, den] = s.r_frame_rate.split("/").map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: num / den,
    frames: parseInt(s.nb_frames, 10) || null,
    duration: parseFloat(j.format.duration),
    bytes: parseInt(j.format.size, 10),
  };
}

const MASTER = probeMaster(IN);
if (!MASTER.frames) {
  // Some containers do not carry nb_frames without a full decode count.
  MASTER.frames = Math.round(MASTER.duration * MASTER.fps);
}
console.log(
  `master: ${IN}\n  ${MASTER.width}x${MASTER.height} ${MASTER.fps}fps ${MASTER.frames}f ` +
  `${MASTER.duration.toFixed(2)}s ${MASTER.bytes} bytes`
);

fs.mkdirSync(OUT, { recursive: true });
const stripsDir = path.join(OUT, "strips");
const blindDir = path.join(OUT, "blind");
fs.mkdirSync(stripsDir, { recursive: true });
fs.mkdirSync(blindDir, { recursive: true });

// ---------------------------------------------------------------------------
// Grid (DESIGN.md V4)
// ---------------------------------------------------------------------------
const BED_DESKTOP = { heights: [1080, 900, 720, 540], crfs: [20, 23, 26, 29], gops: [8, 12] };
const BED_MOBILE = { heights: [720, 540, 432], crfs: [24, 27, 30], gops: [4, 6] };

function buildGrid(def, tier) {
  const out = [];
  for (const height of def.heights) {
    for (const crf of def.crfs) {
      for (const gop of def.gops) {
        out.push({ tier, height, crf, gop, name: `h${height}-crf${crf}-g${gop}.mp4` });
      }
    }
  }
  return out;
}

let candidates = [];
if (TIER === "bed" || TIER === "all") {
  candidates.push(...buildGrid(BED_DESKTOP, "bed-desktop"));
  candidates.push(...buildGrid(BED_MOBILE, "bed-mobile"));
}
const heroAnchors = [
  { tier: "hero-desktop", height: 1080, crf: 20, gop: 8, name: "hero-desktop.mp4" },
  { tier: "hero-mobile", height: 720, crf: 24, gop: 4, name: "hero-mobile.mp4" },
];
if (TIER === "hero" || TIER === "all") candidates.push(...heroAnchors);

console.log(`grid: ${candidates.length} candidate(s)`);

// ---------------------------------------------------------------------------
// Encode: exact same filter chain as encode.sh.
// ---------------------------------------------------------------------------
function encode(c) {
  const out = path.join(OUT, c.name);
  run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", IN,
    "-an",
    "-vf", `scale=-2:${c.height}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(c.crf),
    "-g", String(c.gop), "-keyint_min", String(c.gop), "-sc_threshold", "0",
    "-movflags", "+faststart",
    out,
  ]);
  return out;
}

// ---------------------------------------------------------------------------
// SSIM + PSNR against the master, candidate upscaled to master resolution.
// ---------------------------------------------------------------------------
function measureQuality(candidateFile) {
  const r = run(FFMPEG, [
    "-hide_banner", "-i", IN, "-i", candidateFile,
    "-lavfi",
    `[1:v]scale=${MASTER.width}:${MASTER.height}:flags=lanczos,format=yuv420p[u];` +
    `[u]split=2[u1][u2];[0:v]format=yuv420p,split=2[m1][m2];` +
    `[m1][u1]ssim[sout];[m2][u2]psnr[pout]`,
    "-map", "[sout]", "-map", "[pout]", "-f", "null", "-",
  ]);
  const text = r.stderr || "";
  const ssimMatch = text.match(/All:([\d.]+)/);
  const psnrMatch = text.match(/average:([\d.]+)/);
  return {
    ssim: ssimMatch ? parseFloat(ssimMatch[1]) : null,
    psnr: psnrMatch ? parseFloat(psnrMatch[1]) : null,
  };
}

// ---------------------------------------------------------------------------
// Actual keyframe interval, read back with ffprobe (not trusted from -g).
// ---------------------------------------------------------------------------
function measuredGop(candidateFile) {
  const r = run(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "frame=key_frame", "-of", "csv=p=0", candidateFile,
  ]);
  const flags = r.stdout.trim().split(/\r?\n/).map((v) => v.trim());
  const keyIdx = [];
  flags.forEach((v, i) => { if (v === "1") keyIdx.push(i); });
  if (keyIdx.length < 2) return { intervals: [], mode: null };
  const intervals = [];
  for (let i = 1; i < keyIdx.length; i++) intervals.push(keyIdx[i] - keyIdx[i - 1]);
  const counts = new Map();
  for (const v of intervals) counts.set(v, (counts.get(v) || 0) + 1);
  let mode = intervals[0], best = 0;
  for (const [v, n] of counts) if (n > best) { mode = v; best = n; }
  return { intervals, mode };
}

// ---------------------------------------------------------------------------
// Contact strip: frames at 10%, 50%, 90% of the clip, tiled 3x1.
// ---------------------------------------------------------------------------
function frameIndices(frameCount) {
  const at = (p) => Math.min(frameCount - 1, Math.round(p * (frameCount - 1)));
  return [at(0.10), at(0.50), at(0.90)];
}

function contactStrip(file, frameCount, outPng) {
  const [f1, f2, f3] = frameIndices(frameCount);
  const select = `eq(n\\,${f1})+eq(n\\,${f2})+eq(n\\,${f3})`;
  run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", file,
    "-vf", `select='${select}',scale=480:-2,tile=3x1`,
    "-frames:v", "1", outPng,
  ]);
}

// ---------------------------------------------------------------------------
// Run the grid
// ---------------------------------------------------------------------------
const rows = [];
for (const c of candidates) {
  process.stdout.write(`  encoding ${c.name} ... `);
  const file = encode(c);
  const size = fs.statSync(file).size;
  const q = measureQuality(file);
  const gop = measuredGop(file);
  const stripPng = path.join(stripsDir, c.name.replace(/\.mp4$/, ".strip.png"));
  contactStrip(file, MASTER.frames, stripPng);
  console.log(`${(size / 1024).toFixed(0)}KB  ssim=${q.ssim}  psnr=${q.psnr}  gop_mode=${gop.mode}`);
  rows.push({
    tier: c.tier, name: c.name, height: c.height, crf: c.crf, gop: c.gop,
    size, ssim: q.ssim, psnr: q.psnr,
    measured_gop_mode: gop.mode, measured_gop_intervals: gop.intervals,
    strip: path.relative(OUT, stripPng),
  });
}

// Master's own strip, for reference (unblinded: it is the ground truth, not a
// candidate to be judged).
const masterStripPng = path.join(stripsDir, "master.strip.png");
contactStrip(IN, MASTER.frames, masterStripPng);

// ---------------------------------------------------------------------------
// Blind numbered copies for Gustav's visual pick. Deterministic shuffle
// (seeded) so a re-run of this script reproduces the same numbering; the
// point of "blind" is that the FILENAME does not leak the tier, not that the
// order is unpredictable to the lab.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, seed) {
  const rand = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const shuffled = shuffle(rows, 20260923);
const blindMapping = {};
shuffled.forEach((row, i) => {
  const num = String(i + 1).padStart(4, "0") + ".png";
  fs.copyFileSync(path.join(stripsDir, row.strip.replace(/^strips[\\/]/, "")), path.join(blindDir, num));
  blindMapping[num] = row.name;
});
fs.copyFileSync(masterStripPng, path.join(blindDir, "master-reference.png"));
fs.writeFileSync(
  path.join(blindDir, "mapping.json"),
  JSON.stringify({ generated: new Date().toISOString(), seed: 20260923, mapping: blindMapping }, null, 2)
);

// ---------------------------------------------------------------------------
// phone-candidates.json: what the phone seek session (device-diag.html, A2)
// needs to drive later, without re-deriving the grid.
// ---------------------------------------------------------------------------
fs.writeFileSync(
  path.join(OUT, "phone-candidates.json"),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      master: { file: path.basename(IN), ...MASTER },
      candidates: rows.map((r) => ({
        name: r.name, tier: r.tier, size: r.size, height: r.height, crf: r.crf, gop: r.gop,
      })),
    },
    null,
    2
  )
);

// ---------------------------------------------------------------------------
// Results: JSON + markdown table
// ---------------------------------------------------------------------------
fs.writeFileSync(
  path.join(OUT, "results.json"),
  JSON.stringify({ generated: new Date().toISOString(), in: IN, master: MASTER, rows }, null, 2)
);

const md = [];
md.push(`# encode-lab results`);
md.push("");
md.push(`Master: \`${IN}\`, ${MASTER.width}x${MASTER.height}, ${MASTER.fps}fps, ${MASTER.frames} frames, ` +
  `${MASTER.duration.toFixed(2)}s, ${MASTER.bytes} bytes.`);
md.push("");
md.push("| tier | file | height | crf | gop | size (bytes) | ssim_all | psnr_avg | measured gop |");
md.push("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  md.push(
    `| ${r.tier} | ${r.name} | ${r.height} | ${r.crf} | ${r.gop} | ${r.size} | ` +
    `${r.ssim?.toFixed(6)} | ${r.psnr?.toFixed(3)} | ${r.measured_gop_mode ?? "n/a"} |`
  );
}
fs.writeFileSync(path.join(OUT, "results.md"), md.join("\n") + "\n");

console.log(`\nwrote:\n  ${path.join(OUT, "results.json")}\n  ${path.join(OUT, "results.md")}\n  ${path.join(OUT, "phone-candidates.json")}\n  ${blindDir} (${shuffled.length} blind strips + mapping.json)`);
