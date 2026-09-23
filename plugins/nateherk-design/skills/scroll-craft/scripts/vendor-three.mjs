#!/usr/bin/env node
/**
 * scrollcraft: vendor a pinned, hash-verified three.js into a build.
 *
 * The 3D module (engine/scrollcraft-3d.js) imports three.js from the build's
 * own folder, never from a CDN at runtime: a Cloudflare Pages site should not
 * depend on a third-party origin, and serve.mjs verification has to work
 * offline. This script is the only thing that touches the network. It
 * downloads a fixed file list for one pinned version from jsDelivr's npm
 * mirror, checks every file against a SHA-384 recorded below BEFORE writing
 * anything, and only then writes the files. That gives the guarantee
 * Subresource Integrity would, at vendor time instead of at page load.
 *
 *   node vendor-three.mjs --out builds/acme/vendor/three
 *   node vendor-three.mjs --out builds/acme/vendor/three --check
 *   node vendor-three.mjs --model builds/acme/assets/model.glb
 *   node vendor-three.mjs --print-hashes      (maintainer: bumping VERSION)
 *
 *   --out <dir>       where to write. Default: vendor/three under the cwd.
 *   --check           re-hash the installed files and exit 1 on any mismatch
 *                     or missing file. Writes nothing, needs no network.
 *   --model <file>    print a .glb's size, texture bytes and compression
 *                     extensions (the numbers the 3D budget is judged on).
 *   --print-hashes    download the file list for VERSION and print the
 *                     hashes to paste into FILES. Writes nothing.
 *
 * Why the unminified build: the npm package for the pinned version does not
 * ship build/three.module.min.js. jsDelivr generates a .min.js on request, and
 * its own header on that file says not to pin generated files with SRI,
 * because the minifier can change under the same URL. So this script vendors
 * the static files npm actually publishes (three.module.js, which imports
 * its sibling three.core.js). Served with gzip or brotli (Cloudflare does
 * both) the pair is roughly 420KB gzip or 315KB brotli on the wire.
 *
 * Layout written under --out, mirroring the upstream relative paths so the
 * loaders' own relative imports and import.meta.url lookups resolve:
 *
 *   three.module.js, three.core.js, LICENSE
 *   addons/loaders/{GLTFLoader,DRACOLoader,HDRLoader,RGBELoader}.js
 *   addons/utils/{BufferGeometryUtils,SkeletonUtils}.js
 *   addons/libs/draco/gltf/{draco_wasm_wrapper.js,draco_decoder.wasm,draco_decoder.js}
 *   addons/libs/draco/README.md
 *   three.vendor.json    version plus the installed hashes (for doctor.mjs)
 *
 * The addons import the bare specifier 'three', which a browser cannot
 * resolve without an import map. So each addon's `from 'three'` is rewritten
 * to a relative path to three.module.js. The rewrite is deterministic: the
 * upstream bytes are verified first (sha384), the rewritten bytes are
 * verified second (installed), and --check verifies the installed hashes.
 * Every file resolves to the SAME three.module.js URL, so the page never
 * holds two copies of three.js (two copies break every instanceof inside it).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

// ---------------------------------------------------------------- pinned --
// Bump VERSION, run --print-hashes, paste the output over FILES, run the
// tests in three-d.md, and record version plus hashes in CHANGELOG.md.
export const VERSION = "0.186.0";
const CDN = `https://cdn.jsdelivr.net/npm/three@${VERSION}/`;

// out: path under --out. src: path inside the npm package. sha384: the
// upstream bytes. installed: the bytes written (differs only where the
// 'three' specifier was rewritten). rewrite: relative path to three.module.js.
// Recorded 2026-09-23 and cross-checked against the registry tarball
// three-0.186.0.tgz (integrity sha512-cr/fIM2ddMSVbYVgkfD4jLJv7Fh/8ZTjvo+7gQeS
// VGUZHxpx9FDwoL5iC7hUz/LiRA8wMbqfnb90xKfm1/HHkQ==): every sha384 below is the
// byte-identical file from that tarball.
const FILES = [
  { out: "three.module.js", src: "build/three.module.js",
    sha384: "sha384-m8JoFX52V6NGv2usipnlLJKnJfL7IE8dbniPDDCSGSQv3Hm4n6PjfV6syVwfuoRc" },
  { out: "three.core.js", src: "build/three.core.js",
    sha384: "sha384-mdKeCwPEcbDvzaxwhm+MVuLoMou+E7jQqrs4tmu/n8HBYPGI1kZt0MkJxlMR4zFM" },
  { out: "LICENSE", src: "LICENSE",
    sha384: "sha384-dZIEXnc8kDiJUEWlKdsN+V7yvZT/HbLEL7IFgYWNSRkA0ErUhU5jIL71XpYCHvDY" },
  { out: "addons/loaders/GLTFLoader.js", src: "examples/jsm/loaders/GLTFLoader.js", rewrite: "../../three.module.js",
    sha384: "sha384-jmhN0si8z6E7+h0t9KiwQ71oyrC3PhTpols1FXeN/vODuFa/L4bPIe9sLbOlhjq7",
    installed: "sha384-A/wx2/peKlHDAdMQyCMomVlylyVDBqIt8S9QIPaRHToppjSK7gcvRMgZTIAo3qOc" },
  { out: "addons/loaders/DRACOLoader.js", src: "examples/jsm/loaders/DRACOLoader.js", rewrite: "../../three.module.js",
    sha384: "sha384-6vtmq3WPvctEi9PzdgMxiAGLRIRtWQSrgL9Pxy26rq+Lu2s8qY/tRpq2Ked1wfLW",
    installed: "sha384-ZeZEaTH4Z1Hb/dpY+wq3rWrUwMFyD5bYLBjhhCRGO4JOffrI5516XyAoWjUG+va3" },
  { out: "addons/loaders/HDRLoader.js", src: "examples/jsm/loaders/HDRLoader.js", rewrite: "../../three.module.js",
    sha384: "sha384-fbU1GKwlFx1tBP+OcUiSeQDdBEboM0tGl5vVjihXfzY/0O6/JwPltPR0mbNOXeaS",
    installed: "sha384-1fUKpj7lPjf1VQzbADrcTJq3eXXBrO4m8EcacLgZRSyH3R++32XukJixQqwdx2Xl" },
  { out: "addons/loaders/RGBELoader.js", src: "examples/jsm/loaders/RGBELoader.js",
    sha384: "sha384-NHWk1zi2zXkIhcNyU1inSRgXZagnUPgjCTEKoXlfYQE/m3ZWvDaUm4ElLwOxtd6t" },
  { out: "addons/utils/BufferGeometryUtils.js", src: "examples/jsm/utils/BufferGeometryUtils.js", rewrite: "../../three.module.js",
    sha384: "sha384-Rm97j4mcjlLkGsYC2LX3nZG9VU2R8lgK0QE+DmBr4thue+H7J+SHm+68If2ZLBVg",
    installed: "sha384-fQJprlnxBFcw5fuDZHmh98DRMS4yzgrGu/FoMbkxQLvLiiBaXvpx5S4FqIQwGlrd" },
  { out: "addons/utils/SkeletonUtils.js", src: "examples/jsm/utils/SkeletonUtils.js", rewrite: "../../three.module.js",
    sha384: "sha384-Pozn8j5+YFr3ak8Pm90ayqDrGYn/DV7vVs/YIIqzJhzeJT0LQksoS1fZQ5lfsYlw",
    installed: "sha384-6DYbiIKMg4Yrp+gnE8beQ9RA+HtAnpc+al0GaPK8eMAPadkHUyaoP/Z0rr8kwOC/" },
  { out: "addons/libs/draco/gltf/draco_wasm_wrapper.js", src: "examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js",
    sha384: "sha384-mpx8Y6zmHZEVxr3r2cZhLFOKjJscyKOeHFqkK/LrOh8wC3HGDgGcy6fB37yQntEz" },
  { out: "addons/libs/draco/gltf/draco_decoder.wasm", src: "examples/jsm/libs/draco/gltf/draco_decoder.wasm",
    sha384: "sha384-gJ9GFHPLIX0iGgdYbwba9tNN3lQhBPDtvr64s9owC5NUXLC9oXiSxHT3JqpqgqEY" },
  { out: "addons/libs/draco/gltf/draco_decoder.js", src: "examples/jsm/libs/draco/gltf/draco_decoder.js",
    sha384: "sha384-wG64tkvWuEliR5+9A5b6QVaIqYc2x51IXRI4kzolubldLzZfGWTS9WVk6Q6bT3t7" },
  { out: "addons/libs/draco/README.md", src: "examples/jsm/libs/draco/README.md",
    sha384: "sha384-CW//h6XcUq55m9rQQhccS+DXCPzFmWUCtnuWXkINqkVmm1hwQ14gqIGR+1GmAt80" },
];

// ------------------------------------------------------------------ args --
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const sha384 = (buf) => "sha384-" + crypto.createHash("sha384").update(buf).digest("base64");
const kb = (n) => (n / 1024).toFixed(1) + "KB";

// Matches `from 'three'` and `from "three"` exactly, nothing longer, so
// 'three/addons/...' in a doc comment is never touched.
const BARE = /(\bfrom\s*)(['"])three\2/g;
function rewrite(buf, rel) {
  return Buffer.from(buf.toString("utf8").replace(BARE, `$1$2${rel}$2`), "utf8");
}

// Resolve --out and refuse anything that would write outside it. The paths
// come from the constant table above, so this is belt and braces.
function target(outDir, rel) {
  const p = path.resolve(outDir, rel);
  if (!p.startsWith(path.resolve(outDir) + path.sep)) throw new Error("refusing to write outside --out: " + rel);
  return p;
}

async function download(f) {
  const url = CDN + f.src;
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ------------------------------------------------------------------ modes --
async function printHashes() {
  console.log(`three@${VERSION} from ${CDN}\n`);
  for (const f of FILES) {
    const up = await download(f);
    const line = { out: f.out, sha384: sha384(up) };
    if (f.rewrite) {
      const inst = rewrite(up, f.rewrite);
      line.installed = sha384(inst);
      const n = (up.toString("utf8").match(BARE) || []).length;
      line.rewrites = n;
    }
    console.log(JSON.stringify(line));
  }
}

function check(outDir) {
  let bad = 0;
  for (const f of FILES) {
    const want = f.installed || f.sha384;
    const p = target(outDir, f.out);
    if (!fs.existsSync(p)) { console.log(`MISSING  ${f.out}`); bad++; continue; }
    const got = sha384(fs.readFileSync(p));
    if (got !== want) { console.log(`MISMATCH ${f.out}\n  want ${want}\n  got  ${got}`); bad++; continue; }
    console.log(`ok       ${f.out}`);
  }
  if (bad) {
    console.log(`\n${bad} file(s) do not match three@${VERSION}. Re-run without --check to reinstall.`);
    process.exit(1);
  }
  console.log(`\nthree@${VERSION}: all ${FILES.length} files verified in ${outDir}`);
}

async function install(outDir) {
  if (FILES.some((f) => !f.sha384 || (f.rewrite && !f.installed))) {
    console.error("FILES has empty hashes. Run --print-hashes and paste the output first.");
    process.exit(2);
  }
  // Download and verify EVERYTHING before writing ANYTHING, so a bad byte
  // never leaves a half-updated vendor folder behind.
  const ready = [];
  for (const f of FILES) {
    const up = await download(f);
    const got = sha384(up);
    if (got !== f.sha384) {
      console.error(`HASH MISMATCH for ${f.src} (three@${VERSION})\n  want ${f.sha384}\n  got  ${got}\nNothing was written.`);
      process.exit(1);
    }
    const bytes = f.rewrite ? rewrite(up, f.rewrite) : up;
    if (f.rewrite && sha384(bytes) !== f.installed) {
      console.error(`Rewrite of ${f.src} did not produce the recorded bytes. Nothing was written.`);
      process.exit(1);
    }
    ready.push({ f, bytes });
  }
  fs.mkdirSync(outDir, { recursive: true });
  let gz = 0;
  for (const { f, bytes } of ready) {
    const p = target(outDir, f.out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
    console.log(`wrote ${f.out.padEnd(46)} ${kb(bytes.length)}`);
  }
  // What a visitor pays when the act warms: the core pair plus the glTF path.
  const wire = ["three.module.js", "three.core.js", "addons/loaders/GLTFLoader.js",
    "addons/loaders/DRACOLoader.js", "addons/utils/BufferGeometryUtils.js", "addons/utils/SkeletonUtils.js"];
  for (const { f, bytes } of ready) if (wire.includes(f.out)) gz += zlib.gzipSync(bytes, { level: 9 }).length;
  fs.writeFileSync(target(outDir, "three.vendor.json"), JSON.stringify({
    three: VERSION, source: CDN,
    files: Object.fromEntries(FILES.map((f) => [f.out, f.installed || f.sha384])),
  }, null, 2) + "\n");
  console.log(`\nthree@${VERSION} vendored into ${outDir}, every file hash-verified.`);
  console.log(`JS on warm (module graph for a glTF): ${kb(gz)} gzip. The Draco decoder loads only for a Draco-compressed model.`);
}

// ------------------------------------------------------------------ model --
// A .glb is a 12-byte header then chunks; the first is JSON. Reading it is
// enough to report what the budget is spent on without a glTF library.
function model(file) {
  const buf = fs.readFileSync(file);
  const size = buf.length;
  let json;
  if (buf.readUInt32LE(0) === 0x46546c67) {
    const len = buf.readUInt32LE(12);
    json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
  } else {
    json = JSON.parse(buf.toString("utf8"));
  }
  const views = json.bufferViews || [];
  const imgs = (json.images || []).map((im) => ({
    mime: im.mimeType || path.extname(im.uri || "").slice(1) || "?",
    bytes: im.bufferView !== undefined ? views[im.bufferView].byteLength
      : im.uri && !im.uri.startsWith("data:") && fs.existsSync(path.join(path.dirname(file), im.uri))
        ? fs.statSync(path.join(path.dirname(file), im.uri)).size : 0,
  }));
  const texBytes = imgs.reduce((s, i) => s + i.bytes, 0);
  const ext = json.extensionsUsed || [];
  console.log(`${path.basename(file)}: ${kb(size)} on disk`);
  console.log(`  textures: ${imgs.length}, ${kb(texBytes)} (${[...new Set(imgs.map((i) => i.mime))].join(", ") || "none"})`);
  console.log(`  meshes: ${(json.meshes || []).length}, materials: ${(json.materials || []).length}`);
  console.log(`  geometry compression: ${ext.includes("KHR_draco_mesh_compression") ? "Draco" : ext.includes("EXT_meshopt_compression") ? "meshopt" : "none"}`);
  console.log(`  texture compression: ${ext.includes("KHR_texture_basisu") ? "KTX2 (basisu)" : "none"}`);
  if (ext.includes("EXT_meshopt_compression") || ext.includes("KHR_texture_basisu")) {
    console.log("  note: meshopt and KTX2 need decoders this vendor set does not include; see three-d.md.");
  }
}

// ------------------------------------------------------------------- main --
const OUT = path.resolve(arg("--out", "vendor/three"));
try {
  if (has("--print-hashes")) await printHashes();
  else if (has("--model")) model(path.resolve(arg("--model")));
  else if (has("--check")) check(OUT);
  else await install(OUT);
} catch (e) {
  console.error(String(e && e.message || e));
  process.exit(1);
}
