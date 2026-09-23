#!/usr/bin/env node
/**
 * scope-css: generate engine/scrollcraft-section.css from engine/scrollcraft.css.
 *
 * A section mount (ScrollCraft.mount('#story')) lives inside a host page, so
 * the canonical stylesheet's :root tokens, global reset and browser-surface
 * theming would clobber the host. This script nests every rule under
 * `.sc-scope`, moves the token block onto it, drops the reset and the browser
 * surfaces, makes the scope a self-contained surface, and rewrites the three
 * fixed-position devices so they stay inside the section: the worldflight
 * stage and the progress bar become sticky, the grain overlay absolute.
 *
 *   node scope-css.mjs [--in engine/scrollcraft.css] [--out engine/scrollcraft-section.css]
 *   node scope-css.mjs --check      exit 1 if the committed output is stale
 *
 * Fork addition (Gustav). The output is committed so a build can copy one file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const IN = path.resolve(arg("--in", path.join(here, "..", "engine", "scrollcraft.css")));
const OUT = path.resolve(arg("--out", path.join(here, "..", "engine", "scrollcraft-section.css")));
const CHECK = argv.includes("--check");

const SCOPE = ".sc-scope";

// Selectors (exact, after whitespace collapse) that belong to the page, not to
// a section, and are dropped whole.
const DROP = new Set([
  "*, *::before, *::after",
  "html",
  "body",
  "img, video, canvas, svg",
  "button, input, select, textarea",
  "::selection",
  ":focus-visible",
  ":where(a)",
]);

// ---- a small CSS block parser -----------------------------------------------
// Enough for this file: comments, at-rules with blocks, plain rules. Strings
// and url() never contain braces here, but the walker still skips quoted text.
function parse(css) {
  const nodes = [];
  let i = 0;
  const n = css.length;
  const skipWs = () => { while (i < n && /\s/.test(css[i])) i++; };
  const readUntil = (stops) => {
    let s = "";
    let quote = null;
    while (i < n) {
      const c = css[i];
      if (quote) { s += c; if (c === quote && css[i - 1] !== "\\") quote = null; i++; continue; }
      if (c === '"' || c === "'") { quote = c; s += c; i++; continue; }
      if (c === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); s += css.slice(i, e + 2); i = e + 2; continue; }
      if (stops.includes(c)) return s;
      s += c; i++;
    }
    return s;
  };
  const readBlock = () => {
    // i points at '{'. Return the raw text between the matching braces.
    let depth = 0, start = i + 1, quote = null;
    for (; i < n; i++) {
      const c = css[i];
      if (quote) { if (c === quote && css[i - 1] !== "\\") quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "/" && css[i + 1] === "*") { i = css.indexOf("*/", i + 2) + 1; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { const body = css.slice(start, i); i++; return body; } }
    }
    throw new Error("unbalanced braces");
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (css[i] === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      nodes.push({ type: "comment", text: css.slice(i, e + 2) });
      i = e + 2;
      continue;
    }
    const head = readUntil(["{", ";"]).trim();
    if (css[i] === ";") { i++; nodes.push({ type: "stmt", text: head }); continue; }
    const body = readBlock();
    if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container") || head.startsWith("@layer")) {
      nodes.push({ type: "at", head, children: parse(body) });
    } else {
      nodes.push({ type: "rule", selector: head, body });
    }
  }
  return nodes;
}

// ---- transforms --------------------------------------------------------------
const norm = (s) => s.replace(/\s+/g, " ").trim();

// Split a selector list on TOP-LEVEL commas only: `:is(h1,h2,h3)` and
// `:where(table, .sc-nums)` carry commas that belong to one selector.
function splitTop(sel) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function scopeSelector(sel) {
  return splitTop(sel).map((part) => {
    const p = part.trim();
    if (p === ":root") return SCOPE;
    // The engine writes sc-ready on the scope root itself in section mode.
    if (/^\.sc-ready\b/.test(p)) return SCOPE + p;
    return SCOPE + " " + p;
  }).join(",\n");
}

const STICKY_WORLD = `
  /* Section variant: a sticky stage instead of a fixed one, so the flight
     stays inside the host page. The engine sizes the spacer to total * vh
     because this stage supplies the landing viewport itself. */
  position: sticky; top: 0;
  height: 100vh; height: 100svh;
  overflow: clip;
  z-index: var(--sc-z-stage);
  background: var(--sc-canvas);
`;
const STICKY_COPY = `
  /* Nested inside the sticky stage (the engine moves it there), so absolute. */
  position: absolute; inset: 0;
  z-index: var(--sc-z-copy);
  pointer-events: none;
`;
const STICKY_PROGRESS = `
  /* A fixed bar inside a section reads as the site's. Sticky to the scope's
     top edge instead; the engine feeds it the section's own flow progress. */
  position: sticky; top: 0; height: 2px; z-index: var(--sc-z-chrome);
  display: block;
  background: var(--sc-accent); transform-origin: 0 50%; transform: scaleX(0);
  will-change: transform;
`;

const SECTION_GRAIN = `
  /* Section variant: covers the section, not the viewport. overflow: hidden
     because the drifting ::before sits at inset -50%, which the viewport edge
     clips on a page but which would spill onto the host page here. */
  position: absolute; inset: 0; overflow: hidden;
  pointer-events: none; z-index: 3; opacity: 0.045;
`;

function transformNodes(nodes, inMedia) {
  const out = [];
  let tokensDone = false;
  for (const node of nodes) {
    if (node.type === "comment") { out.push(node); continue; }
    if (node.type === "stmt") { out.push(node); continue; }
    if (node.type === "at") {
      if (node.head.startsWith("@supports") && /scrollbar-color/.test(node.head)) continue;
      const kids = transformNodes(node.children, true);
      if (kids.some((k) => k.type !== "comment")) out.push({ ...node, children: kids });
      continue;
    }
    const sel = norm(node.selector);
    if (DROP.has(sel)) continue;
    // The second :root block (caret and accent colour) is a browser surface.
    if (sel === ":root" && /caret-color/.test(node.body)) continue;
    if (sel === ":root" && !tokensDone && !inMedia) {
      tokensDone = true;
      out.push({ type: "rule", selector: SCOPE, body: node.body });
      continue;
    }
    if (sel === ".sc-world") { out.push({ type: "rule", selector: SCOPE + " .sc-world", body: STICKY_WORLD }); continue; }
    if (sel === ".sc-world__copy") { out.push({ type: "rule", selector: SCOPE + " .sc-world__copy", body: STICKY_COPY }); continue; }
    if (sel === "[data-sc-progress]") { out.push({ type: "rule", selector: SCOPE + " [data-sc-progress]", body: STICKY_PROGRESS }); continue; }
    if (sel === ".sc-grain") { out.push({ type: "rule", selector: SCOPE + " .sc-grain", body: SECTION_GRAIN }); continue; }
    out.push({ type: "rule", selector: scopeSelector(node.selector), body: node.body });
  }
  return out;
}

function print(nodes, indent = "") {
  return nodes.map((node) => {
    if (node.type === "comment") return indent + node.text.split("\n").join("\n" + indent);
    if (node.type === "stmt") return indent + node.text + ";";
    if (node.type === "at") return `${indent}${node.head} {\n${print(node.children, indent + "  ")}\n${indent}}`;
    const body = node.body.replace(/^\s*\n/, "").replace(/\s+$/, "");
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => indent + "  " + l);
    return `${indent}${node.selector} {\n${lines.join("\n")}\n${indent}}`;
  }).join("\n\n");
}

export function generate(css) {
  const nodes = transformNodes(parse(css), false);
  const header = `/* GENERATED by scripts/scope-css.mjs from scrollcraft.css; do not edit.
   Regenerate: node scripts/scope-css.mjs      Check: node scripts/scope-css.mjs --check

   scrollcraft-section.css: the taste floor for ONE SECTION of a host page.
   Every token and rule below is nested under .sc-scope, the class the author
   puts on the mount root (ScrollCraft.mount('#story')). The global reset and
   the browser-surface theming are omitted on purpose: the host owns those.
   Theme by overriding --sc-* tokens on the scope element, never on :root, and
   link this file after the host's stylesheet. */

${SCOPE} {
  position: relative;
  isolation: isolate;
  background: var(--sc-canvas);
  color: var(--sc-ink);
  font-family: var(--sc-font-text);
  font-size: var(--sc-t-base);
  line-height: var(--sc-leading-body);
  letter-spacing: var(--sc-track-normal);
  overflow-x: clip;
}
${SCOPE} :is(img, video, canvas, svg) { display: block; max-width: 100%; }
`;
  return header + "\n" + print(nodes) + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const css = fs.readFileSync(IN, "utf8");
  const next = generate(css);
  if (CHECK) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (cur !== next) {
      console.error(`scope-css: ${path.relative(process.cwd(), OUT)} is stale; run: node scripts/scope-css.mjs`);
      process.exit(1);
    }
    console.log("scope-css: up to date");
    process.exit(0);
  }
  fs.writeFileSync(OUT, next);
  console.log(`scope-css: wrote ${path.relative(process.cwd(), OUT)} (${next.length} bytes)`);
}
